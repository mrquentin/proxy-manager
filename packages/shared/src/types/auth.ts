/**
 * Roles available within an organization.
 *
 * - admin: Full access to all resources and org settings.
 * - operator: Can manage tunnels, routes, and firewall rules, but cannot add/remove VPS or manage members.
 * - viewer: Read-only access to all resources.
 */
export type Role = "admin" | "operator" | "viewer";

/**
 * A user account in the system.
 * Managed by better-auth. A user can belong to multiple organizations.
 */
export interface User {
  /** Unique user identifier. */
  id: string;

  /** Display name. */
  name: string;

  /** Email address (unique). */
  email: string;

  /** Whether the email has been verified. */
  emailVerified: boolean;

  /** Profile image URL (from OAuth provider or uploaded). Null if not set. */
  image: string | null;

  /** ISO 8601 timestamp of when the account was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the last update. */
  updatedAt: string;
}

/**
 * An active session for a user.
 * Managed by better-auth. Tracks the currently active organization.
 */
export interface Session {
  /** Unique session identifier. */
  id: string;

  /** Session token (opaque string). */
  token: string;

  /** The user this session belongs to. */
  userId: string;

  /**
   * The currently active organization for this session.
   * All VPS queries are scoped to this organization.
   * Null if the user hasn't selected an organization yet.
   */
  activeOrganizationId: string | null;

  /** ISO 8601 timestamp of when the session expires. */
  expiresAt: string;

  /** IP address of the client that created the session. */
  ipAddress: string | null;

  /** User agent string of the client that created the session. */
  userAgent: string | null;

  /** ISO 8601 timestamp of when the session was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the last update. */
  updatedAt: string;
}

/**
 * An organization that groups VPS instances and users.
 * Each organization has its own fleet of VPS instances, members, and audit log.
 */
export interface Organization {
  /** Unique organization identifier. */
  id: string;

  /** Organization display name. */
  name: string;

  /** URL-friendly slug (unique). */
  slug: string;

  /** Organization logo URL. Null if not set. */
  logo: string | null;

  /** Metadata JSON blob for extensibility. */
  metadata: string | null;

  /** ISO 8601 timestamp of when the organization was created. */
  createdAt: string;
}

/**
 * A membership linking a user to an organization with a specific role.
 */
export interface Member {
  /** Unique membership identifier. */
  id: string;

  /** The user who is a member. */
  userId: string;

  /** The organization the user belongs to. */
  organizationId: string;

  /** The user's role within this organization. */
  role: Role;

  /** ISO 8601 timestamp of when the membership was created. */
  createdAt: string;
}

/**
 * A pending invitation to join an organization.
 */
export interface Invitation {
  /** Unique invitation identifier. */
  id: string;

  /** Email address the invitation was sent to. */
  email: string;

  /** The organization being invited to. */
  organizationId: string;

  /** The role the user will receive upon accepting. */
  role: Role;

  /** ID of the user who sent the invitation. */
  inviterId: string;

  /** Current status of the invitation. */
  status: "pending" | "accepted" | "rejected" | "canceled";

  /** ISO 8601 timestamp of when the invitation expires. */
  expiresAt: string;

  /** ISO 8601 timestamp of when the invitation was created. */
  createdAt: string;
}

/**
 * A linked authentication provider account (OAuth, email/password, etc.).
 * Managed by better-auth. A user can have multiple linked accounts.
 */
export interface Account {
  /** Unique account link identifier. */
  id: string;

  /** The user this account is linked to. */
  userId: string;

  /** Provider identifier (e.g., "github", "google", "credential"). */
  providerId: string;

  /** The user's account ID at the provider. */
  accountId: string;

  /** ISO 8601 timestamp of when the link was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the last update. */
  updatedAt: string;
}

/**
 * A registered passkey (WebAuthn credential).
 * Managed by better-auth's passkey plugin.
 */
export interface Passkey {
  /** Unique passkey identifier. */
  id: string;

  /** Human-readable name for the passkey (e.g., "MacBook Pro Touch ID"). */
  name: string | null;

  /** The user this passkey belongs to. */
  userId: string;

  /** WebAuthn credential ID (base64url-encoded). */
  credentialId: string;

  /** WebAuthn public key (base64url-encoded). */
  publicKey: string;

  /** Signature counter (incremented on each use, used to detect cloned keys). */
  counter: number;

  /** ISO 8601 timestamp of when the passkey was registered. */
  createdAt: string;
}
