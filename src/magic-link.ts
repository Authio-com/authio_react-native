// Magic-link helpers. The send call is fire-and-forget; the consume
// call decodes the session envelope auth-core returns when called with
// `Accept: application/json` (added on the server side for the mobile
// SDKs).

import type { HTTPClient } from "./http";
import { AuthioError, AuthioErrorCode } from "./errors";
import { decodeEnvelope, type DecodedEnvelope } from "./wire";
import type { SessionEnvelopeWire } from "./types";

export interface SendMagicLinkArgs {
  /** Email or e.164 phone. Auth-core decides which channel to use. */
  destination: string;
  /** Where the user lands after clicking the link. e.g. `myapp://auth`. */
  redirectUri?: string;
  /**
   * Optional org to land the user into. Without this, multi-org users
   * land without an active org and pick one in the picker.
   */
  organizationId?: string;
}

/**
 * POST `/v1/auth/magic-link/send`. The server returns 202 with no body
 * on success. Caller errors (rate-limit, invalid destination) surface
 * as `AuthioError`.
 */
export async function sendMagicLink(
  http: HTTPClient,
  args: SendMagicLinkArgs,
): Promise<void> {
  if (!args.destination) {
    throw new AuthioError({
      code: AuthioErrorCode.InvalidArgument,
      message: "sendMagicLink: destination is required",
    });
  }
  await http.send<unknown>({
    method: "POST",
    path: "/v1/auth/magic-link/send",
    body: {
      destination: args.destination,
      redirect_uri: args.redirectUri,
      organization_id: args.organizationId,
    },
  });
}

/**
 * Hand the SDK the URL we received from a `Linking` deep-link event.
 * We extract the `token` query param, hit the JSON variant of the
 * callback endpoint, and decode the session envelope.
 */
export async function consumeMagicLinkCallback(
  http: HTTPClient,
  url: string,
): Promise<DecodedEnvelope> {
  const token = extractTokenFromUrl(url);
  if (!token) {
    throw new AuthioError({
      code: AuthioErrorCode.MagicLinkInvalidCallback,
      message: `consumeMagicLinkCallback: no 'token' param in URL ${url}`,
    });
  }
  const env = await http.send<SessionEnvelopeWire>({
    method: "POST",
    path: "/v1/auth/magic-link/callback",
    query: { token },
    headers: { accept: "application/json" },
  });
  return decodeEnvelope(env);
}

/**
 * Lightweight URL parser. React Native / Hermes have URLSearchParams
 * but not always a full URL parser — and the deep-link URLs (e.g.
 * `myapp://auth?token=abc`) confuse some implementations. We grep the
 * query string ourselves.
 */
export function extractTokenFromUrl(url: string): string | null {
  return extractQueryParam(url, "token");
}

export function extractQueryParam(url: string, key: string): string | null {
  const q = url.indexOf("?");
  if (q < 0) return null;
  const hashIdx = url.indexOf("#", q + 1);
  const query = hashIdx >= 0 ? url.slice(q + 1, hashIdx) : url.slice(q + 1);
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq >= 0 ? part.slice(0, eq) : part;
    const v = eq >= 0 ? part.slice(eq + 1) : "";
    if (decodeURIComponent(k) === key) {
      return decodeURIComponent(v);
    }
  }
  return null;
}
