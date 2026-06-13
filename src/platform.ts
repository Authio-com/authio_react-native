// Thin shim over `react-native` so the SDK still imports cleanly
// in Node test environments (vitest) where `react-native` doesn't
// resolve. All RN-specific calls go through this module so we can
// stub them in one place.

let linkingMod: { openURL?: (url: string) => Promise<unknown> } | null = null;
let linkingTried = false;

function tryLinking(): { openURL?: (url: string) => Promise<unknown> } | null {
  if (linkingTried) return linkingMod;
  linkingTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require("react-native");
    linkingMod = rn?.Linking ?? null;
  } catch {
    linkingMod = null;
  }
  return linkingMod;
}

/** Default URL opener. Returns null when neither `react-native`'s
 * Linking nor a global `open` is available — callers should treat this
 * as "OAuth not available" and degrade. */
export function defaultURLOpener():
  | ((url: string) => Promise<unknown> | unknown)
  | null {
  const linking = tryLinking();
  if (linking && typeof linking.openURL === "function") {
    return (url: string) => linking!.openURL!(url);
  }
  return null;
}

/** Test-only: install a custom Linking impl. */
export function __setLinkingForTesting(
  impl: { openURL?: (url: string) => Promise<unknown> } | null,
): void {
  linkingMod = impl;
  linkingTried = true;
}
