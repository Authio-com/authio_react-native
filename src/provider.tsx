// AuthioProvider — context that owns the cached session, current user,
// and memberships. Mount once near your app root:
//
// ```tsx
// <AuthioProvider publishableKey={...} apiUrl="https://api.authio.com">
//   <App />
// </AuthioProvider>
// ```
//
// All hooks in `./hooks` read this context.

import * as React from "react";
import { AuthioClient } from "./client";
import { AuthioError } from "./errors";
import type {
  AuthioClientOptions,
  AuthioSession,
  MembershipWithOrg,
  Organization,
  SessionStorage,
  User,
} from "./types";

export interface AuthioContextValue {
  /** True once the provider finished its initial session load. */
  isLoaded: boolean;
  /** Authenticated user, when `isLoaded && session` and verify passed. */
  user: User | null;
  /** Raw session. Pass into imperative APIs that need an access token. */
  session: AuthioSession | null;
  /** Memberships the user can switch into. */
  memberships: MembershipWithOrg[];
  /** Currently-active organization. Null when user hasn't picked one. */
  activeOrganization: Organization | null;
  activeRole: string | null;
  /** Imperative client. Use for sign-in flows that need to update context. */
  client: AuthioClient;
  /* ----- Mutations the provider exposes ----- */
  setSession(session: AuthioSession | null): Promise<void>;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  switchOrganization(organizationId: string): Promise<void>;
}

export const AuthioContext = React.createContext<AuthioContextValue | null>(
  null,
);

export interface AuthioProviderProps
  extends Omit<AuthioClientOptions, "storage"> {
  storage?: SessionStorage;
  children: React.ReactNode;
  /** Pre-configured client. Useful in tests. Takes precedence over keys. */
  client?: AuthioClient;
}

export function AuthioProvider(props: AuthioProviderProps): JSX.Element {
  const { children, client: explicit, ...opts } = props;

  // The client is stable for the provider's lifetime. Recreating it on
  // every render would lose pending OAuth flows.
  const client = React.useMemo(
    () => explicit ?? new AuthioClient(opts as AuthioClientOptions),
    // Intentionally only rebuild when key/url change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [explicit, opts.publishableKey, opts.apiUrl],
  );

  const [isLoaded, setIsLoaded] = React.useState(false);
  const [session, setSessionState] = React.useState<AuthioSession | null>(null);
  const [user, setUser] = React.useState<User | null>(null);
  const [memberships, setMemberships] = React.useState<MembershipWithOrg[]>([]);
  const [activeOrganization, setActiveOrg] =
    React.useState<Organization | null>(null);
  const [activeRole, setActiveRole] = React.useState<string | null>(null);

  // Persist + fan out to all derived state in one helper.
  const setSession = React.useCallback(
    async (next: AuthioSession | null) => {
      setSessionState(next);
      if (next) {
        await client.persist(next);
      } else {
        await client.clear();
        setUser(null);
        setMemberships([]);
        setActiveOrg(null);
        setActiveRole(null);
      }
    },
    [client],
  );

  // Refresh user + memberships against the server using the current
  // session. Safe to call repeatedly; failures clear the local state.
  const refresh = React.useCallback(async () => {
    const current = session;
    if (!current) {
      setUser(null);
      setMemberships([]);
      setActiveOrg(null);
      setActiveRole(null);
      return;
    }
    try {
      const [me, orgs] = await Promise.all([
        client.getMe(current),
        client.listMyOrganizations(current),
      ]);
      setUser(me);
      setMemberships(orgs);
      if (current.orgId) {
        const m = orgs.find((row) => row.organizationId === current.orgId);
        setActiveOrg(m?.organization ?? null);
        setActiveRole(current.role ?? m?.role ?? null);
      } else {
        setActiveOrg(null);
        setActiveRole(null);
      }
    } catch (e) {
      if (e instanceof AuthioError && (e.status === 401 || e.status === 403)) {
        await setSession(null);
        return;
      }
      // Don't kill the session on a transient network blip — just leave
      // the previous user/memberships in place.
    }
  }, [client, session, setSession]);

  // Boot: load any persisted session, verify, populate state.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const persisted = await client.loadSession();
        if (cancelled) return;
        if (!persisted) {
          setIsLoaded(true);
          return;
        }
        const ok = await client.verify(persisted);
        if (cancelled) return;
        if (!ok) {
          await client.clear();
          setIsLoaded(true);
          return;
        }
        setSessionState(persisted);
        try {
          const [me, orgs] = await Promise.all([
            client.getMe(persisted),
            client.listMyOrganizations(persisted),
          ]);
          if (cancelled) return;
          setUser(me);
          setMemberships(orgs);
          if (persisted.orgId) {
            const m = orgs.find(
              (row) => row.organizationId === persisted.orgId,
            );
            setActiveOrg(m?.organization ?? null);
            setActiveRole(persisted.role ?? m?.role ?? null);
          }
        } catch {
          /* keep session, fail open for transient errors */
        }
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const signOut = React.useCallback(async () => {
    const current = session;
    if (current) {
      try {
        await client.revokeSession({ session: current });
      } catch {
        /* even if server-side revoke fails, clear local state */
      }
    }
    await setSession(null);
  }, [client, session, setSession]);

  const switchOrganization = React.useCallback(
    async (organizationId: string) => {
      if (!session) {
        throw new AuthioError({
          code: "no_session",
          message: "switchOrganization: no active session",
        });
      }
      const next = await client.switchOrganization({
        session,
        organizationId,
      });
      setSessionState(next);
      const m = memberships.find(
        (row) => row.organizationId === organizationId,
      );
      setActiveOrg(m?.organization ?? null);
      setActiveRole(next.role ?? m?.role ?? null);
    },
    [client, session, memberships],
  );

  const value: AuthioContextValue = React.useMemo(
    () => ({
      isLoaded,
      user,
      session,
      memberships,
      activeOrganization,
      activeRole,
      client,
      setSession,
      refresh,
      signOut,
      switchOrganization,
    }),
    [
      isLoaded,
      user,
      session,
      memberships,
      activeOrganization,
      activeRole,
      client,
      setSession,
      refresh,
      signOut,
      switchOrganization,
    ],
  );

  return (
    <AuthioContext.Provider value={value}>{children}</AuthioContext.Provider>
  );
}
