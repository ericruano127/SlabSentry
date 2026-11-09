import * as AppleAuthentication from "expo-apple-authentication";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, TextInput } from "react-native";
import { needsMfa, verifyMfa } from "../lib/mfa";
import { supabase } from "../lib/supabase";
import { Button, Card, T, useTheme } from "../lib/ui";

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const t = useTheme();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState(false);
  const [code, setCode] = useState("");
  useEffect(() => { supabase.auth.getSession().then(async ({ data }) => { if (data.session && (await needsMfa())) setMfa(true); }); }, []);
  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, color: t.text, backgroundColor: t.surface, minHeight: 48 } as const;

  async function submit() {
    setBusy(true);
    const { error } = mode === "up"
      ? await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: Linking.createURL("/") } })
      : await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (!error && mode === "in" && (await needsMfa())) return setMfa(true);
    if (error) Alert.alert("Sign in", error.message);
    else if (mode === "up") Alert.alert("Verify your email", "Check your inbox to confirm your email, then sign in. Your first three slab verifications are free — no credit card required.");
  }

  async function apple() {
    try {
      const cred = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL] });
      if (!cred.identityToken) throw new Error("No identity token");
      const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: cred.identityToken });
      if (error) throw error;
    } catch (e: any) {
      if (e.code !== "ERR_REQUEST_CANCELED") Alert.alert("Sign in with Apple", e.message);
    }
  }

  async function google() {
    const redirectTo = Linking.createURL("/auth-callback");
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) return Alert.alert("Google", error?.message ?? "Unavailable");
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type === "success") {
      const code = new URL(res.url).searchParams.get("code");
      if (code) await supabase.auth.exchangeCodeForSession(code);
    }
  }

  if (mfa) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 80, gap: 14 }}>
        <T size={24} bold>Two-factor authentication</T>
        <T muted>Enter the 6-digit code from your authenticator app.</T>
        <TextInput style={input} keyboardType="number-pad" maxLength={6} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} autoComplete="one-time-code" accessibilityLabel="6-digit code" />
        <Button primary title="Verify" disabled={code.length !== 6} busy={busy} onPress={async () => {
          setBusy(true);
          try { await verifyMfa(code); router.replace("/"); } catch (e: any) { Alert.alert("Two-factor", e.message); } finally { setBusy(false); }
        }} />
        <Button title="Sign out" onPress={() => { supabase.auth.signOut(); setMfa(false); }} />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 80, gap: 14 }}>
      <T size={28} bold>SlabGuard</T>
      <T muted>Evidence-based screening for graded cards. Start with 3 free verifications — no credit card required.</T>
      <Card style={{ gap: 12 }}>
        {Platform.OS === "ios" && (
          <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={12} style={{ height: 48 }} onPress={apple} />
        )}
        <Button title="Continue with Google" onPress={google} />
        <T muted size={13}>or use email</T>
        <TextInput style={input} placeholder="Email" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} accessibilityLabel="Email" />
        <TextInput style={input} placeholder="Password" placeholderTextColor={t.muted} secureTextEntry autoComplete={mode === "up" ? "new-password" : "current-password"} value={pw} onChangeText={setPw} accessibilityLabel="Password" />
        <Button primary title={mode === "up" ? "Create free account" : "Sign in"} onPress={submit} busy={busy} disabled={!email || pw.length < 8} />
        <Button title={mode === "up" ? "I already have an account" : "Create a free account"} onPress={() => setMode(mode === "up" ? "in" : "up")} />
        {mode === "in" && <Button title="Forgot password?" onPress={async () => { await supabase.auth.resetPasswordForEmail(email); Alert.alert("Password reset", "If an account exists, a reset link is on its way."); }} disabled={!email} />}
      </Card>
    </ScrollView>
  );
}
