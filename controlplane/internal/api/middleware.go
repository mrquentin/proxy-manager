package api

import (
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/proxy-manager/controlplane/internal/store"
)

// AuditLogger provides audit logging for mutations.
type AuditLogger struct {
	fwStore *store.FirewallStore
}

// NewAuditLogger creates a new AuditLogger.
func NewAuditLogger(fwStore *store.FirewallStore) *AuditLogger {
	return &AuditLogger{fwStore: fwStore}
}

// LoggingMiddleware logs every request with method, path, status, and duration.
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}

		next.ServeHTTP(sw, r)

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"duration", time.Since(start),
			"remote", r.RemoteAddr,
		)
	})
}

// AuditMiddleware logs mutations (POST, PUT, PATCH, DELETE) to the audit_log table.
func AuditMiddleware(al *AuditLogger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only audit mutations
			if r.Method != http.MethodPost && r.Method != http.MethodPut &&
				r.Method != http.MethodPatch && r.Method != http.MethodDelete {
				next.ServeHTTP(w, r)
				return
			}

			// Read and hash the body
			var bodyHash string
			if r.Body != nil {
				bodyBytes, err := io.ReadAll(r.Body)
				if err == nil && len(bodyBytes) > 0 {
					hash := sha256.Sum256(bodyBytes)
					bodyHash = fmt.Sprintf("%x", hash[:8])
					r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
				}
			}

			// Extract client CN from mTLS cert
			clientCN := ""
			if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
				clientCN = r.TLS.PeerCertificates[0].Subject.CommonName
			}

			// Extract source IP
			sourceIP, _, _ := net.SplitHostPort(r.RemoteAddr)

			sw := &statusWriter{ResponseWriter: w, status: 200}
			next.ServeHTTP(sw, r)

			// Write audit log entry
			result := "ok"
			errMsg := ""
			if sw.status >= 400 {
				result = "error"
				errMsg = fmt.Sprintf("HTTP %d", sw.status)
			}

			if err := al.fwStore.WriteAuditLog(clientCN, sourceIP, r.Method, r.URL.Path, bodyHash, result, errMsg); err != nil {
				slog.Error("failed to write audit log", "error", err)
			}
		})
	}
}

// RateLimiter provides a simple per-IP rate limiter.
type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rate     int           // requests per window
	window   time.Duration
}

type visitor struct {
	count    int
	resetAt  time.Time
}

// NewRateLimiter creates a rate limiter that allows `rate` requests per `window` per IP.
func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		window:   window,
	}
	// Cleanup goroutine
	go func() {
		ticker := time.NewTicker(window)
		defer ticker.Stop()
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for ip, v := range rl.visitors {
		if now.After(v.resetAt) {
			delete(rl.visitors, ip)
		}
	}
}

// RateLimitMiddleware applies rate limiting per client IP.
func (rl *RateLimiter) RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		if ip == "" {
			ip = r.RemoteAddr
		}

		rl.mu.Lock()
		v, exists := rl.visitors[ip]
		now := time.Now()
		if !exists || now.After(v.resetAt) {
			rl.visitors[ip] = &visitor{count: 1, resetAt: now.Add(rl.window)}
			rl.mu.Unlock()
			next.ServeHTTP(w, r)
			return
		}

		v.count++
		if v.count > rl.rate {
			rl.mu.Unlock()
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(v.resetAt.Sub(now).Seconds())+1))
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "rate limit exceeded",
			})
			return
		}
		rl.mu.Unlock()

		next.ServeHTTP(w, r)
	})
}

// statusWriter wraps ResponseWriter to capture the status code.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
