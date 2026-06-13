// Wire -> domain mappers. Keep all snake_case → camelCase translation in
// one file so the rest of the SDK can speak in domain types.

import type {
  AuthioSession,
  Membership,
  MembershipWithOrg,
  MembershipWithOrgWire,
  Organization,
  OrganizationWire,
  SessionEnvelopeWire,
  User,
  UserWire,
} from "./types";

export function decodeUser(w: UserWire): User {
  return {
    id: w.id,
    projectId: w.project_id,
    email: w.email,
    emailVerified: w.email_verified,
    name: w.name ?? undefined,
    avatarUrl: w.avatar_url ?? undefined,
    defaultOrganizationId: w.default_organization_id ?? null,
    createdAt: w.created_at ?? undefined,
    updatedAt: w.updated_at ?? undefined,
  };
}

export function decodeOrganization(w: OrganizationWire): Organization {
  return {
    id: w.id,
    projectId: w.project_id,
    name: w.name,
    slug: w.slug,
    createdAt: w.created_at ?? undefined,
  };
}

export function decodeMembership(w: MembershipWithOrgWire): MembershipWithOrg {
  const base: Membership = {
    id: w.id,
    projectId: w.project_id,
    userId: w.user_id,
    organizationId: w.organization_id,
    role: w.role,
    status: w.status,
    joinedAt: w.joined_at ?? undefined,
    lastActiveAt: w.last_active_at ?? undefined,
    preferredLoginMethod: w.preferred_login_method ?? null,
  };
  return { ...base, organization: decodeOrganization(w.organization) };
}

export function decodeMemberships(rows: MembershipWithOrgWire[]): MembershipWithOrg[] {
  return rows.map(decodeMembership);
}

/** Result of decoding a session envelope. The envelope carries the
 * session itself and, optionally, the user/org/memberships we'd have
 * otherwise had to fetch separately. */
export interface DecodedEnvelope {
  session: AuthioSession;
  user?: User;
  activeOrganization?: Organization;
  memberships?: MembershipWithOrg[];
}

export function decodeEnvelope(w: SessionEnvelopeWire): DecodedEnvelope {
  const user = w.user ? decodeUser(w.user) : undefined;
  const activeOrganization = w.active_organization
    ? decodeOrganization(w.active_organization)
    : undefined;
  const session: AuthioSession = {
    sessionId: w.session_id,
    userId: user?.id ?? "",
    orgId: activeOrganization?.id ?? null,
    role: w.active_role ?? null,
    accessToken: w.access_token,
    refreshToken: w.refresh_token ?? null,
    expiresAt: w.expires_at,
  };
  return {
    session,
    user,
    activeOrganization,
    memberships: w.memberships ? decodeMemberships(w.memberships) : undefined,
  };
}
