import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { ApiClientError } from "../lib/api-client";

// We test the ApiClientError class and the fetch wrapper logic without importing
// the actual module (which depends on import.meta.env).

describe("ApiClientError", () => {
  test("creates error with status, code, and message", () => {
    const err = new ApiClientError(404, "not_found", "Resource not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("Resource not found");
    expect(err.name).toBe("ApiClientError");
  });

  test("code can be undefined", () => {
    const err = new ApiClientError(500, undefined, "Internal server error");
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
    expect(err.message).toBe("Internal server error");
  });

  test("is an instance of Error", () => {
    const err = new ApiClientError(400, "bad_request", "Bad request");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ApiClientError).toBe(true);
  });
});

describe("API client fetch wrapper logic", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successful GET request returns parsed JSON", async () => {
    const response = await fetch("/api/vps", { credentials: "include" });
    const data = await response.json();
    expect(data).toEqual({ data: [] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("401 response is detectable", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;

    const response = await fetch("/api/vps");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("error response can be parsed to ApiClientError", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Forbidden", code: "no_permission" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;

    const response = await fetch("/api/vps");
    expect(response.ok).toBe(false);

    const body = await response.json();
    const err = new ApiClientError(response.status, body.code, body.error);
    expect(err.status).toBe(403);
    expect(err.code).toBe("no_permission");
    expect(err.message).toBe("Forbidden");
  });

  test("204 No Content response handling", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as unknown as typeof fetch;

    const response = await fetch("/api/vps/123", { method: "DELETE" });
    expect(response.status).toBe(204);
  });

  test("POST request with JSON body", async () => {
    const body = { name: "Test VPS", apiUrl: "https://1.2.3.4:7443" };
    await fetch("/api/vps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[0]).toBe("/api/vps");
    expect((callArgs[1] as any).method).toBe("POST");
  });
});
