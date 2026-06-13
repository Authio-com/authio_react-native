import { describe, expect, it, beforeEach, vi } from "vitest";
import { __setPasskeyModuleForTesting } from "../passkey";
import { AuthioClient } from "../client";
import { MemoryStorage } from "../storage";

beforeEach(() => {
  __setPasskeyModuleForTesting(null);
});

describe("Passkey module presence", () => {
  it("missing module throws AuthioError with passkey_module_missing", async () => {
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({ publicKey: {}, flowId: "f" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    await expect(c.signInWithPasskey({ email: "x@y.com" })).rejects.toMatchObject(
      { code: "passkey_module_missing" },
    );
  });

  it("invokes Passkey.get(...) for sign-in when module present", async () => {
    const fakeCredential = { id: "cred_id", response: {} };
    const fakePasskey = {
      isSupported: () => true,
      get: vi.fn(async () => fakeCredential),
      create: vi.fn(),
    };
    __setPasskeyModuleForTesting(fakePasskey);

    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/login/options")) {
        return new Response(
          JSON.stringify({
            publicKey: { challenge: "abc" },
            flowId: "flow_1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/login/verify")) {
        return new Response(
          JSON.stringify({
            session_id: "sess_1",
            access_token: "at",
            expires_at: "2099-01-01T00:00:00Z",
            user: { id: "u", email: "x@y.com", email_verified: true },
            active_organization: null,
            active_role: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    const session = await c.signInWithPasskey({ email: "x@y.com" });
    expect(session.sessionId).toBe("sess_1");
    expect(fakePasskey.get).toHaveBeenCalledOnce();
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toContain("/login/options");
    expect(calls[1]!.url).toContain("/login/verify");
    const verifyBody = JSON.parse(calls[1]!.init.body as string);
    expect(verifyBody.flow_id).toBe("flow_1");
    expect(verifyBody.credential).toEqual(fakeCredential);
  });

  it("user-cancelled passkey error maps to passkey_cancelled code", async () => {
    const fakePasskey = {
      get: vi.fn(async () => {
        throw new Error("user cancelled");
      }),
    };
    __setPasskeyModuleForTesting(fakePasskey);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ publicKey: {}, flowId: "f" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      fetch: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    await expect(c.signInWithPasskey()).rejects.toMatchObject({
      code: "passkey_cancelled",
    });
  });
});
