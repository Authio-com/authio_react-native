import * as React from "react";
import { Slot } from "expo-router";
import { AuthioProvider } from "@useauthio/react-native";

const PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_AUTHIO_PUBLISHABLE_KEY ?? "pk_test_replace_me";
const API_URL =
  process.env.EXPO_PUBLIC_AUTHIO_API_URL ?? "https://api.authio.com";

export default function RootLayout(): React.JSX.Element {
  return (
    <AuthioProvider publishableKey={PUBLISHABLE_KEY} apiUrl={API_URL}>
      <Slot />
    </AuthioProvider>
  );
}
