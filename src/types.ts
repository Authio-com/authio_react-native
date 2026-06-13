// Authio React Native SDK — public types.
//
// These shapes mirror the Swift and Kotlin SDKs (authio_swift,
// authio_kotlin) so multi-platform docs and examples are 1:1. The Authio
// REST API uses snake_case on the wire; we re-key to camelCase in the
// HTTP layer (`src/http.ts`).

export interface User {
  id: string;
  /** Project the user lives under. Useful when an app spans projects. */
  projectId?: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
  /**
   * Pinned default org. The hosted-UI uses this when a user with N orgs
   * hits sign-in without an org context.
   */
  defaultOrganizationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Organization {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  createdAt?: string;
}

export type MembershipStatus =
  | "invited"
  | "active"
  | "suspended"
  | "deactivated";

export type PreferredLoginMethod =
  | "passkey"
  | "magic_link"
  | "oauth"
  | "sso"
  | null;

export interface Membership {
  id: string;
  projectId?: string;
  userId?: string;
  organizationId: string;
  role: string;
  status: MembershipStatus;
  joinedAt?: string;
  lastActiveAt?: string;
  preferredLoginMethod?: PreferredLoginMethod;
  invitedBy?: string | null;
}

/** What `/v1/me/organizations` returns: membership + embedded org. */
export interface MembershipWithOrg extends Membership {
  organization: Organization;
}

/**
 * What the caller stores after sign-in. ``accessToken`` is short-lived
 * (~15 min); call ``AuthioClient.verify(session)`` on app launch and
 * re-authenticate when it returns false.
 *
 * ``orgId`` is null when the user has authenticated but not yet selected
 * an organization — common on first login for multi-org users. Render
 * the org picker (``listMyOrganizations`` → ``switchOrganization``)
 * before allowing org-scoped requests.
 */
export interface AuthioSession {
  sessionId: string;
  userId: string;
  orgId: string | null;
  role: string | null;
  accessToken: string;
  refreshToken?: string | null;
  /** ISO-8601 expiry. */
  expiresAt: string;
}

export type OAuthProvider =
  | "google"
  | "microsoft"
  | "apple"
  | "github"
  | "slack"
  | "linkedin"
  | "gitlab";

export interface AuthioClientOptions {
  publishableKey: string;
  apiUrl?: string;
  /**
   * Persistence layer for the cached session. Defaults to
   * AsyncStorage when available, in-memory otherwise.
   */
  storage?: SessionStorage;
  /**
   * Override the deep-link opener. Defaults to `Linking.openURL` when
   * `react-native` is present, otherwise a no-op (web/SSR tests).
   */
  openURL?: (url: string) => Promise<unknown> | unknown;
  /** Override fetch — useful for tests. */
  fetch?: typeof fetch;
}

export interface SessionStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/* ---------------------------------------------------------------- *
 * Wire-only shapes — decoded inside the SDK, never exposed.
 * ---------------------------------------------------------------- */

export interface SessionEnvelopeWire {
  session_id: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at: string;
  user?: UserWire | null;
  active_organization?: OrganizationWire | null;
  active_role?: string | null;
  memberships?: MembershipWithOrgWire[] | null;
}

export interface UserWire {
  id: string;
  project_id?: string;
  email: string;
  email_verified: boolean;
  name?: string | null;
  avatar_url?: string | null;
  default_organization_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OrganizationWire {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  created_at?: string | null;
}

export interface MembershipWithOrgWire {
  id: string;
  project_id?: string;
  user_id?: string;
  organization_id: string;
  role: string;
  status: MembershipStatus;
  joined_at?: string | null;
  last_active_at?: string | null;
  preferred_login_method?: PreferredLoginMethod;
  organization: OrganizationWire;
}
