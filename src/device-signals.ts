/**
 * Optional native device signals for Authio device fingerprinting.
 *
 * Mobile apps may include a platform device identifier when the user
 * has been informed (privacy policy / consent). This is NOT available
 * on web. auth-core hashes all signals server-side.
 */

export interface DeviceSignalsCapture {
  timezone?: string;
  language?: string;
  platform?: string;
  /** iOS identifierForVendor or Android ANDROID_ID when available. */
  platform_device_id?: string;
}

let platformMod: { OS?: string } | null | undefined;

function loadPlatform(): { OS?: string } | null {
  if (platformMod !== undefined) return platformMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    platformMod = require("react-native")?.Platform ?? null;
  } catch {
    platformMod = null;
  }
  return platformMod;
}

/** Collect coarse device signals without requiring optional native deps. */
export async function collectDeviceSignals(): Promise<DeviceSignalsCapture> {
  const out: DeviceSignalsCapture = {};
  try {
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  const Platform = loadPlatform();
  if (Platform?.OS) {
    out.platform = Platform.OS;
  }
  out.platform_device_id = await readOptionalPlatformDeviceID();
  return out;
}

async function readOptionalPlatformDeviceID(): Promise<string | undefined> {
  try {
    // Optional peer — only when the app already uses Expo Application.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Application = require("expo-application");
    const Platform = loadPlatform();
    if (Platform?.OS === "ios" && Application.getIosIdForVendorAsync) {
      const id = await Application.getIosIdForVendorAsync();
      return id || undefined;
    }
    if (Platform?.OS === "android" && Application.androidId) {
      return Application.androidId || undefined;
    }
  } catch {
    /* expo-application not installed — omit platform_device_id */
  }
  return undefined;
}

export function encodeDeviceSignalsHeader(
  signals: DeviceSignalsCapture,
): string {
  const json = JSON.stringify(signals);
  const b64 =
    typeof globalThis.btoa === "function"
      ? globalThis.btoa(json)
      : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const DEVICE_SIGNALS_HEADER = "X-Authio-Device-Signals";

export function deviceSignalsRequestFields(
  signals: DeviceSignalsCapture,
): { device_signals: DeviceSignalsCapture; headers: Record<string, string> } {
  return {
    device_signals: signals,
    headers: { [DEVICE_SIGNALS_HEADER]: encodeDeviceSignalsHeader(signals) },
  };
}
