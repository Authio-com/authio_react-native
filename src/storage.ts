// Storage abstraction. AsyncStorage is the de-facto standard in
// React Native and ships with most apps; we treat it as an *optional*
// peer dependency so the SDK still imports cleanly in unit tests or
// inside SSR/server contexts.

import type { SessionStorage } from "./types";

/** In-memory storage. Default fallback when AsyncStorage isn't around. */
export class MemoryStorage implements SessionStorage {
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Wraps `@react-native-async-storage/async-storage` if installed.
 * Apps using `react-native-keychain` should pass their own wrapper via
 * `AuthioProvider`'s `storage` prop (see README).
 */
export function tryAsyncStorage(): SessionStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-async-storage/async-storage");
    const AsyncStorage = mod?.default ?? mod;
    if (!AsyncStorage || typeof AsyncStorage.getItem !== "function") {
      return null;
    }
    return {
      async get(key: string) {
        return await AsyncStorage.getItem(key);
      },
      async set(key: string, value: string) {
        await AsyncStorage.setItem(key, value);
      },
      async delete(key: string) {
        await AsyncStorage.removeItem(key);
      },
    };
  } catch {
    return null;
  }
}

export function defaultStorage(): SessionStorage {
  return tryAsyncStorage() ?? new MemoryStorage();
}

export const SESSION_STORAGE_KEY = "authio.session";
