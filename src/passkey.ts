// Passkey wrapper around `react-native-passkey`.
//
// react-native-passkey has had a few breaking renames over the years
// (Passkey.register / Passkey.create / Passkey.createPasskey). We
// probe for whichever method is present at runtime; if none, we throw
// a clear `AuthioError({code: "passkey_module_missing"})` so the caller
// can degrade gracefully.

import type { HTTPClient } from "./http";
import { AuthioError, AuthioErrorCode } from "./errors";
import { decodeEnvelope, type DecodedEnvelope } from "./wire";
import type { SessionEnvelopeWire } from "./types";

interface PasskeyModule {
  isSupported?: () => Promise<boolean> | boolean;
  create?: (opts: unknown) => Promise<unknown>;
  createPasskey?: (opts: unknown) => Promise<unknown>;
  register?: (opts: unknown) => Promise<unknown>;
  get?: (opts: unknown) => Promise<unknown>;
  getPasskey?: (opts: unknown) => Promise<unknown>;
  authenticate?: (opts: unknown) => Promise<unknown>;
}

let cachedModule: PasskeyModule | null | undefined;

function loadPasskeyModule(): PasskeyModule {
  if (cachedModule !== undefined) {
    if (!cachedModule) {
      throw new AuthioError({
        code: AuthioErrorCode.PasskeyModuleMissing,
        message:
          "passkey module not installed. Add `react-native-passkey` as a dep " +
          "(`pnpm add react-native-passkey`) and rebuild your native app.",
      });
    }
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("react-native-passkey");
    const Passkey: PasskeyModule = mod?.Passkey ?? mod?.default ?? mod;
    if (!Passkey || (typeof Passkey.create !== "function" &&
        typeof Passkey.createPasskey !== "function" &&
        typeof Passkey.register !== "function" &&
        typeof Passkey.get !== "function" &&
        typeof Passkey.getPasskey !== "function" &&
        typeof Passkey.authenticate !== "function")) {
      cachedModule = null;
      throw new AuthioError({
        code: AuthioErrorCode.PasskeyModuleMissing,
        message:
          "react-native-passkey is present but doesn't expose a known " +
          "create/get API. Upgrade to ^3 or pin a compatible version.",
      });
    }
    cachedModule = Passkey;
    return Passkey;
  } catch (e) {
    if (e instanceof AuthioError) throw e;
    cachedModule = null;
    throw new AuthioError({
      code: AuthioErrorCode.PasskeyModuleMissing,
      message:
        "react-native-passkey is not installed. Add it (`pnpm add react-native-passkey`) " +
        "and rebuild your native app to enable passkey sign-in.",
    });
  }
}

/** Allow tests to inject a fake passkey module. */
export function __setPasskeyModuleForTesting(mod: PasskeyModule | null): void {
  cachedModule = mod ?? undefined;
}

export async function isPasskeySupported(): Promise<boolean> {
  try {
    const mod = loadPasskeyModule();
    if (typeof mod.isSupported === "function") {
      return Boolean(await mod.isSupported());
    }
    return true;
  } catch {
    return false;
  }
}

async function createCredential(options: unknown): Promise<unknown> {
  const mod = loadPasskeyModule();
  if (typeof mod.create === "function") return mod.create(options);
  if (typeof mod.createPasskey === "function") return mod.createPasskey(options);
  if (typeof mod.register === "function") return mod.register(options);
  throw new AuthioError({
    code: AuthioErrorCode.PasskeyModuleMissing,
    message: "passkey module exposes no create/register method",
  });
}

async function getCredential(options: unknown): Promise<unknown> {
  const mod = loadPasskeyModule();
  if (typeof mod.get === "function") return mod.get(options);
  if (typeof mod.getPasskey === "function") return mod.getPasskey(options);
  if (typeof mod.authenticate === "function") return mod.authenticate(options);
  throw new AuthioError({
    code: AuthioErrorCode.PasskeyModuleMissing,
    message: "passkey module exposes no get/authenticate method",
  });
}

/* ---------------------------------------------------------------- *
 * Sign-up (register)
 * ---------------------------------------------------------------- */

export async function signUpWithPasskey(
  http: HTTPClient,
  args: { email: string; name?: string; organizationId?: string },
): Promise<DecodedEnvelope> {
  if (!args.email) {
    throw new AuthioError({
      code: AuthioErrorCode.InvalidArgument,
      message: "signUpWithPasskey: email is required",
    });
  }

  const options = await http.send<{
    publicKey: Record<string, unknown>;
    flowId: string;
  }>({
    method: "POST",
    path: "/v1/auth/passkey/register/options",
    body: {
      email: args.email,
      name: args.name,
      organization_id: args.organizationId,
    },
  });

  const credential = await createCredentialWithCancelHandling(options);

  const env = await http.send<SessionEnvelopeWire>({
    method: "POST",
    path: "/v1/auth/passkey/register/verify",
    body: {
      flow_id: (options as { flowId?: string }).flowId,
      credential,
    },
  });
  return decodeEnvelope(env);
}

/* ---------------------------------------------------------------- *
 * Sign-in (assert)
 * ---------------------------------------------------------------- */

export interface SignInWithPasskeyArgs {
  /** Omit for discoverable (resident-key) login. */
  email?: string;
  organizationId?: string;
}

export async function signInWithPasskey(
  http: HTTPClient,
  args: SignInWithPasskeyArgs = {},
): Promise<DecodedEnvelope> {
  const options = await http.send<{
    publicKey: Record<string, unknown>;
    flowId: string;
  }>({
    method: "POST",
    path: "/v1/auth/passkey/login/options",
    body: {
      email: args.email,
      organization_id: args.organizationId,
    },
  });

  const credential = await getCredentialWithCancelHandling(options);

  const env = await http.send<SessionEnvelopeWire>({
    method: "POST",
    path: "/v1/auth/passkey/login/verify",
    body: {
      flow_id: (options as { flowId?: string }).flowId,
      credential,
    },
  });
  return decodeEnvelope(env);
}

/* ---------------------------------------------------------------- *
 * Small helpers
 * ---------------------------------------------------------------- */

async function createCredentialWithCancelHandling(
  options: unknown,
): Promise<unknown> {
  try {
    return await createCredential(options);
  } catch (e) {
    if (e instanceof AuthioError) throw e;
    throw normalisePasskeyError(e, "register");
  }
}

async function getCredentialWithCancelHandling(
  options: unknown,
): Promise<unknown> {
  try {
    return await getCredential(options);
  } catch (e) {
    if (e instanceof AuthioError) throw e;
    throw normalisePasskeyError(e, "assert");
  }
}

function normalisePasskeyError(e: unknown, phase: string): AuthioError {
  const message = e instanceof Error ? e.message : String(e);
  const lower = message.toLowerCase();
  if (
    lower.includes("cancel") ||
    lower.includes("aborted") ||
    lower.includes("user-cancelled") ||
    lower.includes("user_canceled")
  ) {
    return new AuthioError({
      code: AuthioErrorCode.PasskeyCancelled,
      message: `passkey ${phase} cancelled by user`,
    });
  }
  return new AuthioError({
    code: AuthioErrorCode.PasskeyUnsupported,
    message: `passkey ${phase} failed: ${message}`,
  });
}
