import { describe, expect, it, vi } from "vitest";
import { AuthioClient } from "../client";
import { AuthioError } from "../errors";
import { MemoryStorage } from "../storage";

function mockFetchOk(body: unknown, init?: { status?: number }) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json", "x-request-id": "req_test" },
    }),
  );
}

describe("AuthioClient construction", () => {
  it("requires a publishable key", () => {
    expect(() => new AuthioClient({ publishableKey: "" })).toThrow(AuthioError);
  });

  it("trims trailing slash from apiUrl", () => {
    const c = new AuthioClient({
      publishableKey: "pk_test_x",
      apiUrl: "https://api.example.com////",
    });
    expect(c.apiUrl).toBe("https://api.example.com");
  });

  it("defaults to https://api.authio.com when no apiUrl", () => {
    const c = new AuthioClient({ publishableKey: "pk_test_x" });
    expect(c.apiUrl).toBe("https://api.authio.com");
  });
});

describe("AuthioClient HTTP behaviour", () => {
  it("sends magic link with correct path/body/headers", async () => {
    const fetchMock = mockFetchOk({}, { status: 202 });
    const c = new AuthioClient({
      publishableKey: "pk_test_x",
      apiUrl: "https://api.example.com",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    await c.sendMagicLink({
      destination: "user@example.com",
      redirectUri: "myapp://auth",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/auth/magic-link/send");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-authio-publishable-key"]).toBe("pk_test_x");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["accept"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      destination: "user@example.com",
      redirect_uri: "myapp://auth",
    });
  });

  it("consumeMagicLinkCallback parses token and POSTs JSON callback", async () => {
    const envelope = {
      session_id: "sess_1",
      access_token: "at_xyz",
      expires_at: "2099-01-01T00:00:00Z",
      user: {
        id: "usr_1",
        email: "x@y.com",
        email_verified: true,
      },
      active_organization: {
        id: "org_1",
        project_id: "prj_1",
        name: "Acme",
        slug: "acme",
      },
      active_role: "admin",
    };
    const fetchMock = mockFetchOk(envelope);
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    const session = await c.consumeMagicLinkCallback(
      "myapp://auth?token=abc123&other=ignored",
    );
    expect(session.sessionId).toBe("sess_1");
    expect(session.orgId).toBe("org_1");
    expect(session.role).toBe("admin");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.example.com/v1/auth/magic-link/callback?token=abc123",
    );
    expect((init.headers as Record<string, string>)["accept"]).toBe(
      "application/json",
    );
  });

  it("throws AuthioError with code on 4xx", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: "invalid_token", message: "bad" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const c = new AuthioClient({
      publishableKey: "pk",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    await expect(
      c.sendMagicLink({ destination: "x@y.com" }),
    ).rejects.toMatchObject({
      code: "invalid_token",
      status: 401,
      message: "bad",
    });
  });

  it("verify returns false on 401", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("", { status: 401 }),
    );
    const c = new AuthioClient({
      publishableKey: "pk",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    const ok = await c.verify({
      sessionId: "s",
      userId: "u",
      orgId: null,
      role: null,
      accessToken: "at",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    expect(ok).toBe(false);
  });

  it("verify short-circuits to false when locally expired", async () => {
    const fetchMock = vi.fn();
    const c = new AuthioClient({
      publishableKey: "pk",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    const ok = await c.verify({
      sessionId: "s",
      userId: "u",
      orgId: null,
      role: null,
      accessToken: "at",
      expiresAt: "2000-01-01T00:00:00Z",
    });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switchOrganization posts select-org with bearer and persists new session", async () => {
    const envelope = {
      session_id: "sess_2",
      access_token: "at_new",
      expires_at: "2099-01-01T00:00:00Z",
      user: { id: "usr_1", email: "x@y.com", email_verified: true },
      active_organization: {
        id: "org_2",
        project_id: "prj_1",
        name: "Beta",
        slug: "beta",
      },
      active_role: "member",
    };
    const fetchMock = mockFetchOk(envelope);
    const storage = new MemoryStorage();
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      fetch: fetchMock as unknown as typeof fetch,
      storage,
    });
    const next = await c.switchOrganization({
      session: {
        sessionId: "sess_1",
        userId: "usr_1",
        orgId: "org_1",
        role: "admin",
        accessToken: "at_old",
        expiresAt: "2099-01-01T00:00:00Z",
      },
      organizationId: "org_2",
    });
    expect(next.orgId).toBe("org_2");
    expect(next.accessToken).toBe("at_new");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/sessions/select-org");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer at_old",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      organization_id: "org_2",
    });
    const persisted = await storage.get("authio.session");
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted!).orgId).toBe("org_2");
  });

  it("revokeSession clears storage", async () => {
    const fetchMock = mockFetchOk({});
    const storage = new MemoryStorage();
    await storage.set("authio.session", "{}");
    const c = new AuthioClient({
      publishableKey: "pk",
      fetch: fetchMock as unknown as typeof fetch,
      storage,
    });
    await c.revokeSession({
      session: {
        sessionId: "s",
        userId: "u",
        orgId: null,
        role: null,
        accessToken: "at",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    expect(await storage.get("authio.session")).toBeNull();
  });
});
