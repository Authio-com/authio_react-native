import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { AuthioClient } from "../client";
import { AuthioProvider } from "../provider";
import { MemoryStorage } from "../storage";
import {
  useUser,
  useOrganizations,
  useActiveOrganization,
  useSwitchOrganization,
  useSignOut,
} from "../hooks";
import type { AuthioSession } from "../types";

function envelopeFor(orgId = "org_1", role = "admin") {
  return {
    session_id: "sess_1",
    access_token: "at",
    expires_at: "2099-01-01T00:00:00Z",
    user: {
      id: "usr_1",
      email: "x@y.com",
      email_verified: true,
      name: "Test User",
    },
    active_organization: {
      id: orgId,
      project_id: "prj_1",
      name: "Acme",
      slug: "acme",
    },
    active_role: role,
  };
}

function meBody() {
  return {
    id: "usr_1",
    email: "x@y.com",
    email_verified: true,
    name: "Test User",
  };
}

function membershipsBody() {
  return [
    {
      id: "m_1",
      organization_id: "org_1",
      role: "admin",
      status: "active",
      organization: {
        id: "org_1",
        project_id: "prj_1",
        name: "Acme",
        slug: "acme",
      },
    },
    {
      id: "m_2",
      organization_id: "org_2",
      role: "member",
      status: "active",
      organization: {
        id: "org_2",
        project_id: "prj_1",
        name: "Beta",
        slug: "beta",
      },
    },
  ];
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchRouter(routes: Record<string, (init: RequestInit) => Response>) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) return handler(init);
    }
    return new Response("not routed: " + url, { status: 500 });
  });
}

function newClient(args: {
  fetchImpl: typeof fetch;
  storage: MemoryStorage;
}) {
  return new AuthioClient({
    publishableKey: "pk",
    apiUrl: "https://api.example.com",
    fetch: args.fetchImpl,
    storage: args.storage,
  });
}

function HookProbe(props: { onState: (s: ReturnType<typeof gatherState>) => void }) {
  const u = useUser();
  const orgs = useOrganizations();
  const active = useActiveOrganization();
  React.useEffect(() => {
    props.onState({ u, orgs, active });
  });
  return null;
}

function gatherState() {
  // Just to give TS a return type for the prop above.
  return {} as {
    u: ReturnType<typeof useUser>;
    orgs: ReturnType<typeof useOrganizations>;
    active: ReturnType<typeof useActiveOrganization>;
  };
}

describe("AuthioProvider", () => {
  it("loads persisted session, hydrates user + memberships + active org", async () => {
    const persisted: AuthioSession = {
      sessionId: "sess_1",
      userId: "usr_1",
      orgId: "org_1",
      role: "admin",
      accessToken: "at",
      expiresAt: "2099-01-01T00:00:00Z",
    };
    const storage = new MemoryStorage();
    await storage.set("authio.session", JSON.stringify(persisted));

    const fetchImpl = fetchRouter({
      "/v1/me/organizations": () => jsonResp(membershipsBody()),
      "/v1/me": () => jsonResp(meBody()),
    });
    const client = newClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });

    const states: Array<ReturnType<typeof gatherState>> = [];
    render(
      <AuthioProvider publishableKey="pk" client={client}>
        <HookProbe onState={(s) => states.push(s)} />
      </AuthioProvider>,
    );

    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last?.u.isLoaded).toBe(true);
      expect(last?.u.user?.email).toBe("x@y.com");
      expect(last?.orgs.memberships.length).toBe(2);
      expect(last?.active.organization?.id).toBe("org_1");
      expect(last?.active.role).toBe("admin");
    });
  });

  it("isSignedIn is false when storage is empty", async () => {
    const fetchImpl = fetchRouter({});
    const client = newClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    const states: Array<ReturnType<typeof gatherState>> = [];
    render(
      <AuthioProvider publishableKey="pk" client={client}>
        <HookProbe onState={(s) => states.push(s)} />
      </AuthioProvider>,
    );
    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last?.u.isLoaded).toBe(true);
      expect(last?.u.isSignedIn).toBe(false);
      expect(last?.u.user).toBeNull();
    });
  });

  it("clears state when verify returns 401", async () => {
    const persisted: AuthioSession = {
      sessionId: "sess_1",
      userId: "usr_1",
      orgId: "org_1",
      role: "admin",
      accessToken: "at",
      expiresAt: "2099-01-01T00:00:00Z",
    };
    const storage = new MemoryStorage();
    await storage.set("authio.session", JSON.stringify(persisted));
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const client = newClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });
    const states: Array<ReturnType<typeof gatherState>> = [];
    render(
      <AuthioProvider publishableKey="pk" client={client}>
        <HookProbe onState={(s) => states.push(s)} />
      </AuthioProvider>,
    );
    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last?.u.isLoaded).toBe(true);
      expect(last?.u.isSignedIn).toBe(false);
    });
    expect(await storage.get("authio.session")).toBeNull();
  });
});

describe("hooks: switchOrganization + signOut", () => {
  it("switchOrganization updates active org and persists new session", async () => {
    const persisted: AuthioSession = {
      sessionId: "sess_1",
      userId: "usr_1",
      orgId: "org_1",
      role: "admin",
      accessToken: "at",
      expiresAt: "2099-01-01T00:00:00Z",
    };
    const storage = new MemoryStorage();
    await storage.set("authio.session", JSON.stringify(persisted));
    const fetchImpl = fetchRouter({
      "/v1/me/organizations": () => jsonResp(membershipsBody()),
      "/v1/me": () => jsonResp(meBody()),
      "/v1/sessions/select-org": () => jsonResp(envelopeFor("org_2", "member")),
    });
    const client = newClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });

    let switcher: ReturnType<typeof useSwitchOrganization> | null = null;
    let active: ReturnType<typeof useActiveOrganization> | null = null;

    function Probe() {
      switcher = useSwitchOrganization();
      active = useActiveOrganization();
      return null;
    }

    render(
      <AuthioProvider publishableKey="pk" client={client}>
        <Probe />
      </AuthioProvider>,
    );
    await waitFor(() => expect(active?.organization?.id).toBe("org_1"));

    await act(async () => {
      await switcher!("org_2");
    });

    await waitFor(() => {
      expect(active?.organization?.id).toBe("org_2");
      expect(active?.role).toBe("member");
    });
    const stored = await storage.get("authio.session");
    expect(JSON.parse(stored!).orgId).toBe("org_2");
  });

  it("signOut clears state and storage", async () => {
    const persisted: AuthioSession = {
      sessionId: "sess_1",
      userId: "usr_1",
      orgId: "org_1",
      role: "admin",
      accessToken: "at",
      expiresAt: "2099-01-01T00:00:00Z",
    };
    const storage = new MemoryStorage();
    await storage.set("authio.session", JSON.stringify(persisted));
    const fetchImpl = fetchRouter({
      "/v1/me/organizations": () => jsonResp(membershipsBody()),
      "/v1/me": () => jsonResp(meBody()),
      "/v1/sessions/revoke": () => jsonResp({}),
    });
    const client = newClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });

    let signOut: ReturnType<typeof useSignOut> | null = null;
    let user: ReturnType<typeof useUser> | null = null;

    function Probe() {
      signOut = useSignOut();
      user = useUser();
      return null;
    }

    render(
      <AuthioProvider publishableKey="pk" client={client}>
        <Probe />
      </AuthioProvider>,
    );
    await waitFor(() => expect(user?.isSignedIn).toBe(true));

    await act(async () => {
      await signOut!();
    });

    await waitFor(() => expect(user?.isSignedIn).toBe(false));
    expect(await storage.get("authio.session")).toBeNull();
  });
});
