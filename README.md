<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.png">
    <img alt="Authio" src=".github/logo-light.png" width="220">
  </picture>
</p>

# @useauthio/react-native

> Part of **[Authio Lobby](https://authio.com/products/lobby)** —
> Authio's drop-in passwordless authentication. Learn more at
> https://authio.com/products/lobby.

Authio React Native SDK — passwordless, multi-org auth for iOS, Android, and
Expo apps. Native passkeys (`react-native-passkey`), magic link, OAuth via
deep link, and a session API where a single user can carry multiple
organization memberships.

The public surface mirrors the
[Swift](https://github.com/authio-com/authio_swift) and
[Kotlin](https://github.com/authio-com/authio_kotlin) SDKs, so docs and patterns
are 1:1 across platforms.

## Install

```bash
pnpm add @useauthio/react-native
# Optional peer deps — install the ones you actually use:
pnpm add react-native-passkey                       # passkeys
pnpm add @react-native-async-storage/async-storage  # session persistence
```

The SDK degrades cleanly: if `react-native-passkey` isn't installed, passkey
calls throw `AuthioError({ code: "passkey_module_missing" })`. If
AsyncStorage isn't installed, the SDK falls back to in-memory storage.

## Quick start

```tsx
// App.tsx
import { AuthioProvider } from "@useauthio/react-native";

export default function App() {
  return (
    <AuthioProvider
      publishableKey={process.env.EXPO_PUBLIC_AUTHIO_PUBLISHABLE_KEY!}
      apiUrl="https://api.authio.com"
    >
      <RootStack />
    </AuthioProvider>
  );
}
```

```tsx
// SignInScreen.tsx
import {
  useAuthio,
  useUser,
  useOrganizations,
  useActiveOrganization,
  useSwitchOrganization,
} from "@useauthio/react-native";

export default function SignInScreen() {
  const authio = useAuthio();
  const { user, isLoaded, isSignedIn } = useUser();
  const { memberships } = useOrganizations();
  const { organization, role } = useActiveOrganization();
  const switchOrg = useSwitchOrganization();

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <Button
        title="Sign in with passkey"
        onPress={() => authio.client.signInWithPasskey()}
      />
    );
  }
  return (
    <View>
      <Text>Hello, {user!.email}</Text>
      <Text>Active org: {organization?.name} • {role}</Text>
      {memberships.map((m) => (
        <Button
          key={m.id}
          title={`Switch to ${m.organization.name}`}
          onPress={() => switchOrg(m.organizationId)}
        />
      ))}
    </View>
  );
}
```

## Sign-in flows

```ts
// Passkey
const session = await authio.client.signInWithPasskey();              // discoverable
const session = await authio.client.signInWithPasskey({ email });     // scoped
const session = await authio.client.signUpWithPasskey({ email });

// Magic link
await authio.client.sendMagicLink({
  destination: "user@example.com",
  redirectUri: "myapp://auth",
});
// When the deep link arrives:
const session = await authio.client.consumeMagicLinkCallback(url);

// OAuth — opens the system browser, awaits deep-link callback
const session = await authio.client.signInWithOAuth({
  provider: "google",
  redirectUri: "myapp://auth",
});
// In your Linking.addEventListener("url", ...) handler:
await authio.client.consumeOAuthCallback(url);

// Multi-org
const memberships = await authio.client.listMyOrganizations(session);
const next = await authio.client.switchOrganization({
  session,
  organizationId: "org_...",
});

// Sign out
await authio.client.revokeSession({ session });
```

## Deep links

Both magic-link and OAuth flows expect your app to declare a deep-link scheme
(e.g. `myapp://`). When a callback URL arrives via
`Linking.addEventListener("url", ...)`, forward it to the appropriate
SDK method:

```ts
Linking.addEventListener("url", async ({ url }) => {
  if (url.includes("token=")) {
    await authio.client.consumeMagicLinkCallback(url);
  } else if (url.includes("state=")) {
    await authio.client.consumeOAuthCallback(url);
  }
  await authio.refresh();
});
```

## Custom session storage

By default, sessions persist via `@react-native-async-storage/async-storage`.
For production you should typically use the iOS Keychain / Android Keystore
via `react-native-keychain`. Pass a `storage` implementation to either
`AuthioProvider` or `AuthioClient`:

```ts
import * as Keychain from "react-native-keychain";

const storage = {
  async get(key: string) {
    const c = await Keychain.getGenericPassword({ service: key });
    return c ? c.password : null;
  },
  async set(key: string, value: string) {
    await Keychain.setGenericPassword(key, value, { service: key });
  },
  async delete(key: string) {
    await Keychain.resetGenericPassword({ service: key });
  },
};

<AuthioProvider publishableKey={...} apiUrl={...} storage={storage}>
  <App />
</AuthioProvider>
```

## Errors

All SDK methods reject with `AuthioError` carrying:

```ts
class AuthioError extends Error {
  code: string;       // e.g. "passkey_module_missing", "invalid_credential"
  status: number;     // HTTP status when server-side, 0 otherwise
  requestId?: string; // Authio request ID for support tickets
}
```

Stable local codes are in `AuthioErrorCode`:

| code                        | when                                          |
|-----------------------------|-----------------------------------------------|
| `passkey_module_missing`    | `react-native-passkey` not installed          |
| `passkey_cancelled`         | User dismissed the OS prompt                  |
| `oauth_cancelled`           | OAuth flow cancelled or timed out             |
| `oauth_invalid_callback`    | Deep-link URL missing required params         |
| `magic_link_invalid_callback` | Deep-link URL missing `token`               |
| `network_error`             | `fetch` itself failed                         |
| `server_error`              | Non-2xx with no specific server code          |

## Hooks reference

| hook | returns |
|------|---------|
| `useAuthio()` | full context: `client`, `session`, `user`, `memberships`, `refresh`, `signOut`, `switchOrganization` |
| `useUser()` | `{ user, session, isLoaded, isSignedIn }` |
| `useOrganizations()` | `{ memberships, isLoaded }` |
| `useActiveOrganization()` | `{ organization, role }` |
| `useSwitchOrganization()` | `(organizationId: string) => Promise<void>` |
| `useSignOut()` | `() => Promise<void>` |

## Example

A complete Expo Router example is in `examples/expo/`. See
`examples/expo/README.md` for run instructions.

## License

MIT
