// OAuth helpers.
//
// Mobile OAuth runs entirely in the system browser:
//   1. `signInWithOAuth({provider, redirectUri})` opens
//      `${apiUrl}/v1/auth/oauth/${provider}/authorize?...` via
//      `Linking.openURL` (or any custom opener).
//   2. The customer's app declares the deep-link scheme in
//      `app.json`/manifest and catches the callback URL.
//   3. The app forwards that URL to `consumeOAuthCallback(url)`. We
//      look up the pending promise by `state` and resolve it.

import type { HTTPClient } from "./http";
import { AuthioError, AuthioErrorCode } from "./errors";
import { extractQueryParam } from "./magic-link";
import { decodeEnvelope, type DecodedEnvelope } from "./wire";
import type { OAuthProvider, SessionEnvelopeWire } from "./types";

interface PendingFlow {
  resolve: (env: DecodedEnvelope) => void;
  reject: (err: AuthioError) => void;
  createdAt: number;
}

const pending = new Map<string, PendingFlow>();

/** Reset internal state — test-only. */
export function __resetOAuthForTesting(): void {
  pending.clear();
}

/**
 * Cryptographically-strong random ID for the OAuth `state` param.
 *
 * `state` is the OAuth-flow CSRF defence: the SDK generates it before
 * redirecting to the IdP and verifies the echoed value on callback.
 * The value MUST be unpredictable — a `Math.random` fallback would
 * silently downgrade the security posture on RN apps that haven't
 * installed `react-native-get-random-values`. We fail closed with an
 * actionable error instead. (SECURITY_AUDIT_CRYPTO_KEY_MGMT_2026-05-24
 * CRY-03.)
 */
function generateState(): string {
  // 16 random bytes -> base64url -> 22 chars.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error(
      "authio: crypto.getRandomValues is unavailable. Install " +
        "react-native-get-random-values and import it at the top of " +
        "your app entry (before any Authio call) so OAuth state is " +
        "generated with a CSPRNG.",
    );
  }
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoaUrlSafe(bin);
}

function btoaUrlSafe(s: string): string {
  // happy-dom and RN both provide btoa.
  const b64 =
    typeof btoa === "function"
      ? btoa(s)
      : Buffer.from(s, "binary").toString("base64");
  return b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export interface SignInWithOAuthArgs {
  provider: OAuthProvider;
  redirectUri: string;
  /** Where to land — pass through to the server. */
  organizationId?: string;
  /** Optional override of the system browser opener. */
  openURL?: (url: string) => Promise<unknown> | unknown;
  /** Per-call timeout in ms (default 5 min). */
  timeoutMs?: number;
  /** Optional pre-computed state — useful for tests. */
  state?: string;
}

export interface SignInWithOAuthHandle {
  /** Promise resolves once `consumeOAuthCallback` runs with matching state. */
  promise: Promise<DecodedEnvelope>;
  /** The state value embedded in the URL. */
  state: string;
  /** The full authorize URL we opened. */
  authorizeUrl: string;
  /** Abort the pending flow (rejects the promise). */
  cancel(): void;
}

/**
 * Start an OAuth flow. The returned promise resolves when the customer
 * app calls `consumeOAuthCallback(url)` with a matching `state`.
 *
 * Common usage:
 * ```
 * const session = await authio.signInWithOAuth({
 *   provider: "google",
 *   redirectUri: "myapp://auth",
 * });
 * ```
 */
export function startOAuth(
  http: HTTPClient,
  args: SignInWithOAuthArgs,
): SignInWithOAuthHandle {
  if (!args.provider) {
    throw new AuthioError({
      code: AuthioErrorCode.InvalidArgument,
      message: "signInWithOAuth: provider is required",
    });
  }
  if (!args.redirectUri) {
    throw new AuthioError({
      code: AuthioErrorCode.InvalidArgument,
      message: "signInWithOAuth: redirectUri is required",
    });
  }
  const opener = args.openURL;
  if (!opener) {
    throw new AuthioError({
      code: AuthioErrorCode.OAuthOpenerMissing,
      message:
        "signInWithOAuth: no openURL implementation available. Install " +
        "react-native or pass `openURL` in AuthioProvider options.",
    });
  }

  const state = args.state ?? generateState();
  const authorizeUrl = http.buildURL(
    `/v1/auth/oauth/${encodeURIComponent(args.provider)}/authorize`,
    {
      redirect_uri: args.redirectUri,
      state,
      organization_id: args.organizationId,
    },
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<DecodedEnvelope>((resolve, reject) => {
    pending.set(state, {
      resolve: (env) => {
        if (timer) clearTimeout(timer);
        pending.delete(state);
        resolve(env);
      },
      reject: (err) => {
        if (timer) clearTimeout(timer);
        pending.delete(state);
        reject(err);
      },
      createdAt: Date.now(),
    });
    if (args.timeoutMs && args.timeoutMs > 0) {
      timer = setTimeout(() => {
        const p = pending.get(state);
        if (p) {
          p.reject(
            new AuthioError({
              code: AuthioErrorCode.OAuthCancelled,
              message: `OAuth flow timed out after ${args.timeoutMs}ms`,
            }),
          );
        }
      }, args.timeoutMs);
    }
  });

  // Kick off the browser open — but don't await it. If it fails, reject
  // the pending promise so callers see one consistent error.
  Promise.resolve(opener(authorizeUrl)).catch((e) => {
    const p = pending.get(state);
    if (p) {
      p.reject(
        new AuthioError({
          code: AuthioErrorCode.OAuthCancelled,
          message: `failed to open authorize URL: ${
            e instanceof Error ? e.message : String(e)
          }`,
        }),
      );
    }
  });

  return {
    promise,
    state,
    authorizeUrl,
    cancel() {
      const p = pending.get(state);
      if (p) {
        p.reject(
          new AuthioError({
            code: AuthioErrorCode.OAuthCancelled,
            message: "OAuth flow cancelled",
          }),
        );
      }
    },
  };
}

/**
 * Resolve the pending OAuth flow for the given callback URL. Call this
 * from your deep-link handler (e.g. `Linking.addEventListener("url", ...)`).
 *
 * Returns the session envelope on success, or throws `AuthioError` if
 * there is no matching pending flow or the URL is malformed.
 */
export async function consumeOAuthCallback(
  http: HTTPClient,
  url: string,
): Promise<DecodedEnvelope> {
  const state = extractQueryParam(url, "state");
  if (!state) {
    throw new AuthioError({
      code: AuthioErrorCode.OAuthInvalidCallback,
      message: `consumeOAuthCallback: no 'state' param in URL ${url}`,
    });
  }
  const error = extractQueryParam(url, "error");
  if (error) {
    const desc = extractQueryParam(url, "error_description") ?? error;
    const p = pending.get(state);
    const err = new AuthioError({
      code: AuthioErrorCode.OAuthCancelled,
      message: `oauth provider error: ${desc}`,
      details: { error, description: desc },
    });
    if (p) p.reject(err);
    throw err;
  }

  // The flow yields either a directly-baked session envelope in the
  // querystring (preferred, no second round trip) or a `code` we must
  // exchange. Support both.
  const accessToken = extractQueryParam(url, "access_token");
  const sessionId = extractQueryParam(url, "session_id");
  const refreshToken = extractQueryParam(url, "refresh_token") ?? undefined;
  const expiresAt = extractQueryParam(url, "expires_at");

  if (accessToken && sessionId && expiresAt) {
    const env = decodeEnvelope({
      session_id: sessionId,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      expires_at: expiresAt,
      user: null,
      active_organization: null,
      active_role: null,
      memberships: null,
    });
    const p = pending.get(state);
    if (p) p.resolve(env);
    return env;
  }

  const code = extractQueryParam(url, "code");
  if (!code) {
    const err = new AuthioError({
      code: AuthioErrorCode.OAuthInvalidCallback,
      message: `consumeOAuthCallback: URL missing access_token or code: ${url}`,
    });
    const p = pending.get(state);
    if (p) p.reject(err);
    throw err;
  }

  const wire = await http.send<SessionEnvelopeWire>({
    method: "POST",
    path: "/v1/auth/oauth/exchange",
    body: { code, state },
  });
  const env = decodeEnvelope(wire);
  const p = pending.get(state);
  if (p) p.resolve(env);
  return env;
}

/** Internal: number of pending flows. For tests/debugging. */
export function _pendingCount(): number {
  return pending.size;
}
