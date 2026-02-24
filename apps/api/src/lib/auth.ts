import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Env } from "./env";

/**
 * Define resource-level permissions for RBAC.
 * Each resource declares the actions that can be performed on it.
 */
export const ac = createAccessControl({
  vps: ["create", "read", "update", "delete"],
  tunnel: ["create", "read", "delete", "rotate"],
  route: ["create", "read", "delete"],
  firewall: ["create", "read", "delete"],
  member: ["invite", "read", "remove", "update-role"],
  settings: ["read", "update"],
});

/**
 * Admin role: full access to all resources and org settings.
 */
const adminRole = ac.newRole({
  vps: ["create", "read", "update", "delete"],
  tunnel: ["create", "read", "delete", "rotate"],
  route: ["create", "read", "delete"],
  firewall: ["create", "read", "delete"],
  member: ["invite", "read", "remove", "update-role"],
  settings: ["read", "update"],
});

/**
 * Operator role: manage tunnels, routes, firewall; view-only VPS and members.
 */
const operatorRole = ac.newRole({
  vps: ["read"],
  tunnel: ["create", "read", "delete", "rotate"],
  route: ["create", "read", "delete"],
  firewall: ["create", "read", "delete"],
  member: ["read"],
  settings: ["read"],
});

/**
 * Viewer role: read-only across all resources.
 */
const viewerRole = ac.newRole({
  vps: ["read"],
  tunnel: ["read"],
  route: ["read"],
  firewall: ["read"],
  member: ["read"],
  settings: ["read"],
});

/**
 * Create the better-auth instance with all plugins and providers.
 *
 * @param db - Drizzle ORM database instance.
 * @param env - Validated environment variables.
 */
export function createAuth(db: ReturnType<typeof import("@proxy-manager/db").createDatabase>, env: Env) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.JWT_SECRET,

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },

    plugins: [
      passkey({
        rpName: "Proxy Manager",
        rpID: env.PASSKEY_RP_ID,
        origin: env.PASSKEY_ORIGIN,
      }),
      organization({
        ac,
        roles: {
          admin: adminRole,
          operator: operatorRole,
          viewer: viewerRole,
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
