package caddy

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetL4Config(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/config/apps/layer4" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Errorf("unexpected method: %s", r.Method)
		}

		cfg := L4Config{
			Servers: map[string]*L4Server{
				"proxy": {
					Listen: []string{"0.0.0.0:443"},
					Routes: []CaddyRoute{
						{
							ID: "route-tun_1-443",
							Match: []RouteMatch{{TLS: &TLSMatch{SNI: []string{"app.example.com"}}}},
							Handle: []RouteHandle{{Handler: "proxy", Upstreams: []RouteUpstream{{Dial: []string{"10.0.0.2:443"}}}}},
						},
					},
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := NewHTTPClientWithHTTPClient(server.Client(), server.URL)

	cfg, err := client.GetL4Config(context.Background())
	if err != nil {
		t.Fatalf("get l4 config: %v", err)
	}

	if len(cfg.Servers) != 1 {
		t.Fatalf("expected 1 server, got %d", len(cfg.Servers))
	}

	proxy, ok := cfg.Servers["proxy"]
	if !ok {
		t.Fatal("expected proxy server")
	}

	if len(proxy.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(proxy.Routes))
	}

	if proxy.Routes[0].ID != "route-tun_1-443" {
		t.Errorf("expected route ID route-tun_1-443, got %s", proxy.Routes[0].ID)
	}
}

func TestGetL4ConfigNotFound(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := NewHTTPClientWithHTTPClient(server.Client(), server.URL)

	cfg, err := client.GetL4Config(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Servers) != 0 {
		t.Errorf("expected 0 servers for 404, got %d", len(cfg.Servers))
	}
}

func TestCreateServer(t *testing.T) {
	var receivedBody map[string]interface{}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/config/apps/layer4/servers/proxy" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}

		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)

		w.WriteHeader(http.StatusOK)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := NewHTTPClientWithHTTPClient(server.Client(), server.URL)

	err := client.CreateServer(context.Background())
	if err != nil {
		t.Fatalf("create server: %v", err)
	}

	if receivedBody["@id"] != "l4-main" {
		t.Errorf("expected @id l4-main, got %v", receivedBody["@id"])
	}
}

func TestAddRoute(t *testing.T) {
	var receivedRoute CaddyRoute

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/config/apps/layer4/servers/proxy/routes" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}

		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedRoute)

		w.WriteHeader(http.StatusOK)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := NewHTTPClientWithHTTPClient(server.Client(), server.URL)

	route := BuildCaddyRoute("route-tun_1-443", []string{"app.example.com"}, "10.0.0.2:443")

	err := client.AddRoute(context.Background(), route)
	if err != nil {
		t.Fatalf("add route: %v", err)
	}

	if receivedRoute.ID != "route-tun_1-443" {
		t.Errorf("expected route ID route-tun_1-443, got %s", receivedRoute.ID)
	}
	if len(receivedRoute.Match) == 0 || receivedRoute.Match[0].TLS == nil {
		t.Fatal("expected TLS match")
	}
	if receivedRoute.Match[0].TLS.SNI[0] != "app.example.com" {
		t.Errorf("expected SNI app.example.com, got %s", receivedRoute.Match[0].TLS.SNI[0])
	}
}

func TestDeleteRoute(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/id/route-tun_1-443" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodDelete {
			t.Errorf("unexpected method: %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := NewHTTPClientWithHTTPClient(server.Client(), server.URL)

	err := client.DeleteRoute(context.Background(), "route-tun_1-443")
	if err != nil {
		t.Fatalf("delete route: %v", err)
	}
}

func TestDeleteRouteError(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := NewHTTPClientWithHTTPClient(server.Client(), server.URL)

	err := client.DeleteRoute(context.Background(), "route-nonexistent")
	if err == nil {
		t.Fatal("expected error on 500 response")
	}
}

func TestBuildCaddyRoute(t *testing.T) {
	route := BuildCaddyRoute("route-tun_abc-443", []string{"a.com", "b.com"}, "10.0.0.2:443")

	if route.ID != "route-tun_abc-443" {
		t.Errorf("expected ID route-tun_abc-443, got %s", route.ID)
	}
	if len(route.Match) != 1 {
		t.Fatalf("expected 1 match, got %d", len(route.Match))
	}
	if len(route.Match[0].TLS.SNI) != 2 {
		t.Fatalf("expected 2 SNI values, got %d", len(route.Match[0].TLS.SNI))
	}
	if len(route.Handle) != 1 {
		t.Fatalf("expected 1 handle, got %d", len(route.Handle))
	}
	if route.Handle[0].Handler != "proxy" {
		t.Errorf("expected handler proxy, got %s", route.Handle[0].Handler)
	}
	if route.Handle[0].Upstreams[0].Dial[0] != "10.0.0.2:443" {
		t.Errorf("expected upstream 10.0.0.2:443, got %s", route.Handle[0].Upstreams[0].Dial[0])
	}
}
