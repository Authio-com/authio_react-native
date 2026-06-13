import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthioClient } from "../client";
import { MemoryStorage } from "../storage";
import { __resetOAuthForTesting, _pendingCount } from "../oauth";

beforeEach(() => {
  __resetOAuthForTesting();
});

describe("OAuth start + consume", () => {
  it("opens the authorize URL with provider+redirect+state", async () => {
    const opener = vi.fn(async () => undefined);
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      openURL: opener,
      storage: new MemoryStorage(),
    });
    const handle = c.startOAuth({
      provider: "google",
      redirectUri: "myapp://auth",
      state: "fixed_state",
    });
    expect(handle.state).toBe("fixed_state");
    expect(handle.authorizeUrl).toContain(
      "/v1/auth/oauth/google/authorize?",
    );
    expect(handle.authorizeUrl).toContain("redirect_uri=myapp%3A%2F%2Fauth");
    expect(handle.authorizeUrl).toContain("state=fixed_state");
    // Give the microtask queue a tick for opener.
    await Promise.resolve();
    expect(opener).toHaveBeenCalledWith(handle.authorizeUrl);
    // pending count should be > 0 until we cancel.
    expect(_pendingCount()).toBe(1);
    handle.cancel();
    await handle.promise.catch(() => undefined);
    expect(_pendingCount()).toBe(0);
  });

  it("rejects when no opener is available", () => {
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      openURL: null as unknown as undefined,
      storage: new MemoryStorage(),
    });
    expect(() =>
      c.startOAuth({ provider: "google", redirectUri: "myapp://auth" }),
    ).toThrow(/openURL/);
  });

  it("consumeOAuthCallback with access_token resolves the pending flow", async () => {
    const opener = vi.fn(async () => undefined);
    const c = new AuthioClient({
      publishableKey: "pk",
      apiUrl: "https://api.example.com",
      openURL: opener,
      storage: new MemoryStorage(),
    });
    const handle = c.startOAuth({
      provider: "google",
      redirectUri: "myapp://auth",
      state: "s1",
    });
    const callbackUrl =
      "myapp://auth?state=s1&access_token=at_1&session_id=sess_1&expires_at=2099-01-01T00:00:00Z&refresh_token=rt_1";
    await c.consumeOAuthCallback(callbackUrl);
    const env = await handle.promise;
    expect(env.session.sessionId).toBe("sess_1");
    expect(env.session.accessToken).toBe("at_1");
    expect(env.session.refreshToken).toBe("rt_1");
  });

  it("consumeOAuthCallback with `error` param rejects pending flow", async () => {
    const opener = vi.fn(async () => undefined);
    const c = new AuthioClient({
      publishableKey: "pk",
      openURL: opener,
      storage: new MemoryStorage(),
    });
    const handle = c.startOAuth({
      provider: "google",
      redirectUri: "myapp://auth",
      state: "s2",
    });
    await c
      .consumeOAuthCallback(
        "myapp://auth?state=s2&error=access_denied&error_description=User%20rejected",
      )
      .catch(() => undefined);
    await expect(handle.promise).rejects.toMatchObject({
      code: "oauth_cancelled",
    });
  });

  it("consumeOAuthCallback rejects when state missing", async () => {
    const c = new AuthioClient({
      publishableKey: "pk",
      openURL: vi.fn(async () => undefined),
      storage: new MemoryStorage(),
    });
    await expect(
      c.consumeOAuthCallback("myapp://auth?access_token=x"),
    ).rejects.toMatchObject({ code: "oauth_invalid_callback" });
  });
});
