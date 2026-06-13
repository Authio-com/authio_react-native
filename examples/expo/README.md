# Authio React Native Example (Expo)

A minimal Expo Router app that demonstrates every flow `@useauthio/react-native`
ships:

- Sign in with passkey (discoverable or scoped)
- Sign up with passkey
- Magic link (email)
- OAuth (Google) via deep link
- Multi-org membership list + switch
- Sign out

## Run it

```sh
cd examples/expo
pnpm install
EXPO_PUBLIC_AUTHIO_PUBLISHABLE_KEY=pk_test_xxx \
EXPO_PUBLIC_AUTHIO_API_URL=https://api.authio.com \
pnpm start
```

Then press `i` for iOS Simulator or `a` for Android Emulator.

> Passkeys only work on real devices on iOS (Simulator does not have a
> passkey provider). Magic link + OAuth flows work in Simulator.

## How the SDK is wired

`app/_layout.tsx` mounts `<AuthioProvider>` once at the root. `app/index.tsx`
uses the hooks (`useUser`, `useOrganizations`, `useActiveOrganization`,
`useSwitchOrganization`, `useSignOut`) to drive UI and calls into the
imperative `client` for the sign-in actions.

Deep links arrive in `Linking.addEventListener("url", …)`. We forward magic-link
URLs (`?token=…`) to `client.consumeMagicLinkCallback(url)` and OAuth URLs
(`?state=…`) to `client.consumeOAuthCallback(url)`. The `state` map inside the
SDK matches them with the pending `signInWithOAuth(...)` promise.

## Custom domain / RP ID

The WebAuthn RP ID must match the domain that serves your Authio API. To
use a custom domain, update `app.json`'s `associatedDomains` / Android
Asset Links and the Authio project's `webauthn_rp_id` accordingly.
