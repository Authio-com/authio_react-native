// AuthioClient — imperative SDK surface. Wraps HTTP + passkey + OAuth +
// magic-link into a single object the customer instantiates once per
// app launch.
//
// Mobile clients only carry the *publishable* key (`pk_live_…`). The
// secret key never leaves the customer's server; server-side CRUD goes
// through the Management API, which is deliberately not surfaced here.

import { HTTPClient } from "./http";
import { AuthioError, AuthioErrorCode } from "./errors";
import {
  consumeMagicLinkCallback as consumeMagicLink,
  sendMagicLink,
  type SendMagicLinkArgs,
} from "./magic-link";
import {
  signInWithPasskey as doSignInWithPasskey,
  signUpWithPasskey as doSignUpWithPasskey,
  isPasskeySupported,
  type SignInWithPasskeyArgs,
} from "./passkey";
import {
  consumeOAuthCallback as doConsumeOAuthCallback,
  startOAuth,
  type SignInWithOAuthArgs,
  type SignInWithOAuthHandle,
} from "./oauth";
import { defaultStorage, SESSION_STORAGE_KEY } from "./storage";
import { defaultURLOpener } from "./platform";
import { decodeMemberships, decodeUser, decodeEnvelope } from "./wire";
import type { DecodedEnvelope } from "./wire";
import type {
  AuthioClientOptions,
  AuthioSession,
  MembershipWithOrg,
  MembershipWithOrgWire,
  SessionEnvelopeWire,
  SessionStorage,
  User,
  UserWire,
} from "./types";

const DEFAULT_API_URL = "https://api.authio.com";

export class AuthioClient {
  readonly publishableKey: string;
  readonly apiUrl: string;
  readonly storage: SessionStorage;
  readonly http: HTTPClient;
  private readonly opener:
    | ((url: string) => Promise<unknown> | unknown)
    | null;

  constructor(opts: AuthioClientOptions) {
    if (!opts.publishableKey) {
      throw new AuthioError({
        code: AuthioErrorCode.MissingPublishableKey,
        message: "AuthioClient: publishableKey is required",
      });
    }
    this.publishableKey = opts.publishableKey;
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.storage = opts.storage ?? defaultStorage();
    this.http = new HTTPClient({
      baseURL: this.apiUrl,
      publishableKey: this.publishableKey,
      fetchImpl: opts.fetch,
    });
    this.opener = opts.openURL ?? defaultURLOpener();
  }

  /* ---------------- Passkey ---------------- */

  async isPasskeySupported(): Promise<boolean> {
    return isPasskeySupported();
  }

  async signInWithPasskey(
    args: SignInWithPasskeyArgs = {},
  ): Promise<AuthioSession> {
    const env = await doSignInWithPasskey(this.http, args);
    await this.persist(env.session);
    return env.session;
  }

  async signUpWithPasskey(args: {
    email: string;
    name?: string;
    organizationId?: string;
  }): Promise<AuthioSession> {
    const env = await doSignUpWithPasskey(this.http, args);
    await this.persist(env.session);
    return env.session;
  }

  /* ---------------- Magic link ---------------- */

  async sendMagicLink(args: SendMagicLinkArgs): Promise<void> {
    await sendMagicLink(this.http, args);
  }

  async consumeMagicLinkCallback(url: string): Promise<AuthioSession> {
    const env = await consumeMagicLink(this.http, url);
    await this.persist(env.session);
    return env.session;
  }

  /* ---------------- OAuth ---------------- */

  /**
   * Start an OAuth flow. Resolves once the customer app forwards the
   * deep-link callback to `consumeOAuthCallback`. Returns the new
   * session.
   */
  async signInWithOAuth(
    args: Omit<SignInWithOAuthArgs, "openURL">,
  ): Promise<AuthioSession> {
    const handle = this.startOAuth(args);
    const env = await handle.promise;
    await this.persist(env.session);
    return env.session;
  }

  /**
   * Advanced: get a handle to the pending OAuth flow (state, URL,
   * cancel). Most callers want `signInWithOAuth` instead.
   */
  startOAuth(
    args: Omit<SignInWithOAuthArgs, "openURL">,
  ): SignInWithOAuthHandle {
    return startOAuth(this.http, { ...args, openURL: this.opener ?? undefined });
  }

  async consumeOAuthCallback(url: string): Promise<AuthioSession> {
    const env = await doConsumeOAuthCallback(this.http, url);
    await this.persist(env.session);
    return env.session;
  }

  /* ---------------- Session ops ---------------- */

  /**
   * Round-trip `/v1/me` with the access token. Returns true if the
   * server accepts the token.
   */
  async verify(session: AuthioSession): Promise<boolean> {
    if (!session.accessToken) return false;
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return false;
    }
    try {
      await this.http.send<UserWire>({
        method: "GET",
        path: "/v1/me",
        bearer: session.accessToken,
      });
      return true;
    } catch (e) {
      if (e instanceof AuthioError && (e.status === 401 || e.status === 403)) {
        return false;
      }
      throw e;
    }
  }

  async getMe(session: AuthioSession): Promise<User> {
    const w = await this.http.send<UserWire>({
      method: "GET",
      path: "/v1/me",
      bearer: session.accessToken,
    });
    return decodeUser(w);
  }

  async listMyOrganizations(
    session: AuthioSession,
  ): Promise<MembershipWithOrg[]> {
    const w = await this.http.send<
      { data: MembershipWithOrgWire[] } | MembershipWithOrgWire[]
    >({
      method: "GET",
      path: "/v1/me/organizations",
      bearer: session.accessToken,
    });
    const rows = Array.isArray(w) ? w : w.data;
    return decodeMemberships(rows ?? []);
  }

  async switchOrganization(args: {
    session: AuthioSession;
    organizationId: string;
  }): Promise<AuthioSession> {
    const env = await this.http.send<SessionEnvelopeWire>({
      method: "POST",
      path: "/v1/sessions/select-org",
      body: { organization_id: args.organizationId },
      bearer: args.session.accessToken,
    });
    const decoded = decodeEnvelope(env);
    await this.persist(decoded.session);
    return decoded.session;
  }

  async revokeSession(args: {
    session: AuthioSession;
    sessionId?: string;
  }): Promise<void> {
    const sessionId = args.sessionId ?? args.session.sessionId;
    await this.http.send<unknown>({
      method: "POST",
      path: "/v1/sessions/revoke",
      body: { session_id: sessionId },
      bearer: args.session.accessToken,
    });
    await this.clear();
  }

  /* ---------------- Storage ---------------- */

  async loadSession(): Promise<AuthioSession | null> {
    const raw = await this.storage.get(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthioSession;
    } catch {
      return null;
    }
  }

  async persist(session: AuthioSession): Promise<void> {
    await this.storage.set(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  async clear(): Promise<void> {
    await this.storage.delete(SESSION_STORAGE_KEY);
  }

  /* ---------------- Convenience ---------------- */

  /** Expose the decoded envelope for callers that need user/memberships
   * inline (e.g. the provider). */
  async signInWithPasskeyEnvelope(
    args: SignInWithPasskeyArgs = {},
  ): Promise<DecodedEnvelope> {
    const env = await doSignInWithPasskey(this.http, args);
    await this.persist(env.session);
    return env;
  }

  async signUpWithPasskeyEnvelope(args: {
    email: string;
    name?: string;
    organizationId?: string;
  }): Promise<DecodedEnvelope> {
    const env = await doSignUpWithPasskey(this.http, args);
    await this.persist(env.session);
    return env;
  }

  async consumeMagicLinkCallbackEnvelope(url: string): Promise<DecodedEnvelope> {
    const env = await consumeMagicLink(this.http, url);
    await this.persist(env.session);
    return env;
  }
}
