import { describe, it, expect, mock } from "bun:test";
import { Hono } from "hono";
import { createAuthRoutes } from "../routes/auth";
import type { Auth } from "../lib/auth";

describe("auth routes", () => {
  function createApp(handlerResponse: Response = new Response("ok", { status: 200 })) {
    const auth = {
      handler: mock(() => handlerResponse),
      api: {},
    } as unknown as Auth;

    const app = new Hono();
    app.route("/", createAuthRoutes(auth));
    return { app, auth };
  }

  it("should forward GET requests to better-auth handler", async () => {
    const { app, auth } = createApp(new Response(JSON.stringify({ session: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const res = await app.request("/api/auth/session");
    expect(res.status).toBe(200);
    expect(auth.handler).toHaveBeenCalled();
  });

  it("should forward POST requests to better-auth handler", async () => {
    const { app, auth } = createApp(new Response(JSON.stringify({ user: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password" }),
    });
    expect(res.status).toBe(200);
    expect(auth.handler).toHaveBeenCalled();
  });

  it("should handle nested auth paths", async () => {
    const { app, auth } = createApp();

    await app.request("/api/auth/sign-up/email", { method: "POST" });
    expect(auth.handler).toHaveBeenCalled();
  });

  it("should handle passkey auth paths", async () => {
    const { app, auth } = createApp();

    await app.request("/api/auth/passkey/register", { method: "POST" });
    expect(auth.handler).toHaveBeenCalled();
  });

  it("should handle organization auth paths", async () => {
    const { app, auth } = createApp();

    await app.request("/api/auth/organization/create", { method: "POST" });
    expect(auth.handler).toHaveBeenCalled();
  });
});
