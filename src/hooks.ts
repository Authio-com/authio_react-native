// React hooks. Thin wrappers over `AuthioContext` so consumers don't
// have to deal with the `null` check in every component.

import * as React from "react";
import { AuthioContext, type AuthioContextValue } from "./provider";
import type {
  MembershipWithOrg,
  Organization,
  User,
  AuthioSession,
} from "./types";
import type { AuthioClient } from "./client";

function ctx(): AuthioContextValue {
  const v = React.useContext(AuthioContext);
  if (!v) {
    throw new Error(
      "useAuthio: AuthioProvider not found. Wrap your app in <AuthioProvider>.",
    );
  }
  return v;
}

/** Everything in the context, plus the raw client. */
export function useAuthio(): AuthioContextValue {
  return ctx();
}

/** The bare AuthioClient — for callers that don't need React state. */
export function useAuthioClient(): AuthioClient {
  return ctx().client;
}

export interface UseUserResult {
  user: User | null;
  session: AuthioSession | null;
  isLoaded: boolean;
  isSignedIn: boolean;
}

export function useUser(): UseUserResult {
  const c = ctx();
  return {
    user: c.user,
    session: c.session,
    isLoaded: c.isLoaded,
    isSignedIn: c.isLoaded && c.user != null,
  };
}

export interface UseOrganizationsResult {
  memberships: MembershipWithOrg[];
  isLoaded: boolean;
}

export function useOrganizations(): UseOrganizationsResult {
  const c = ctx();
  return { memberships: c.memberships, isLoaded: c.isLoaded };
}

export interface UseActiveOrganizationResult {
  organization: Organization | null;
  role: string | null;
}

export function useActiveOrganization(): UseActiveOrganizationResult {
  const c = ctx();
  return { organization: c.activeOrganization, role: c.activeRole };
}

/**
 * Returns a switcher function. Pass an organization ID; the provider
 * updates state, persists the new session, and resolves once the
 * server confirms the pivot.
 *
 * ```tsx
 * const switchOrg = useSwitchOrganization();
 * await switchOrg("org_123");
 * ```
 */
export function useSwitchOrganization(): (organizationId: string) => Promise<void> {
  const c = ctx();
  return c.switchOrganization;
}

/** Returns an idempotent sign-out function. */
export function useSignOut(): () => Promise<void> {
  return ctx().signOut;
}
