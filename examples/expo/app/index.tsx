import * as React from "react";
import {
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import {
  useAuthio,
  useUser,
  useOrganizations,
  useActiveOrganization,
  useSwitchOrganization,
  useSignOut,
} from "@useauthio/react-native";

const REDIRECT_URI = Linking.createURL("auth");

export default function SignInScreen(): React.JSX.Element {
  const authio = useAuthio();
  const { isLoaded, user, isSignedIn, session } = useUser();
  const { memberships } = useOrganizations();
  const { organization, role } = useActiveOrganization();
  const switchOrg = useSwitchOrganization();
  const signOut = useSignOut();

  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    const sub = Linking.addEventListener("url", async ({ url }) => {
      try {
        if (url.includes("token=")) {
          await authio.client.consumeMagicLinkCallback(url);
          await authio.refresh();
        } else if (url.includes("state=")) {
          await authio.client.consumeOAuthCallback(url);
          await authio.refresh();
        }
      } catch (e) {
        Alert.alert("Auth error", String(e));
      }
    });
    return () => sub.remove();
  }, [authio]);

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert(label, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!isLoaded) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
    );
  }

  if (isSignedIn) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Welcome, {user?.name ?? user?.email}</Text>
        <Text style={styles.sub}>Active org: {organization?.name ?? "(none)"} • {role ?? "—"}</Text>
        <Text style={styles.h2}>Your organizations</Text>
        {memberships.map((m) => (
          <View key={m.id} style={styles.row}>
            <Text style={styles.org}>{m.organization.name} ({m.role})</Text>
            <Button
              title={m.organizationId === organization?.id ? "Active" : "Switch"}
              disabled={m.organizationId === organization?.id}
              onPress={() => wrap("Switch", () => switchOrg(m.organizationId))}
            />
          </View>
        ))}
        <View style={{ height: 24 }} />
        <Button title="Sign out" onPress={() => wrap("Sign out", signOut)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.h1}>Sign in</Text>
      <Text style={styles.sub}>Authio React Native example</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />

      <Button
        title={busy === "passkey" ? "Passkey…" : "Sign in with passkey"}
        onPress={() =>
          wrap("passkey", async () => {
            await authio.client.signInWithPasskey({ email: email || undefined });
            await authio.refresh();
          })
        }
      />
      <View style={{ height: 8 }} />
      <Button
        title={busy === "passkey-up" ? "Signing up…" : "Sign up with passkey"}
        disabled={!email}
        onPress={() =>
          wrap("passkey-up", async () => {
            await authio.client.signUpWithPasskey({ email });
            await authio.refresh();
          })
        }
      />
      <View style={{ height: 8 }} />
      <Button
        title={busy === "magic" ? "Sending…" : "Email me a magic link"}
        disabled={!email}
        onPress={() =>
          wrap("magic", async () => {
            await authio.client.sendMagicLink({
              destination: email,
              redirectUri: REDIRECT_URI,
            });
            Alert.alert("Check your email", `Sent magic link to ${email}`);
          })
        }
      />
      <View style={{ height: 8 }} />
      <Button
        title={busy === "google" ? "Opening…" : "Continue with Google"}
        onPress={() =>
          wrap("google", async () => {
            await authio.client.signInWithOAuth({
              provider: "google",
              redirectUri: REDIRECT_URI,
            });
            await authio.refresh();
          })
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  h1: { fontSize: 28, fontWeight: "700", marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: "600", marginTop: 16 },
  sub: { fontSize: 14, color: "#666", marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    fontSize: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  org: { fontSize: 16 },
});
