import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Switch, View } from "react-native";
import { api } from "../lib/api";
import { config } from "../lib/config";
import { supabase } from "../lib/supabase";
import { Button, Card, T } from "../lib/ui";

/** Required before using the app: accept current Terms + Privacy; training consent is optional and off by default. */
export default function Consent() {
  const [st, setSt] = useState<any>(null);
  const [notice, setNotice] = useState<string>("");
  const [agree, setAgree] = useState(false);
  const [training, setTraining] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/api/consent").then(setSt);
    api("/api/legal").then((r) => setNotice(r.documents.find((d: any) => d.kind === "data_collection")?.body ?? ""));
  }, []);
  if (!st) return <T>Loading…</T>;
  const open = (slug: string) => Linking.openURL(`${config.apiUrl}/legal/${slug}`);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingTop: 60 }}>
      <T size={24} bold>{st.terms.accepted ? "We've updated our terms" : "Before you start"}</T>
      <T>Slab Guard reports are guidance, <T bold>not a guarantee of authenticity</T>. Location and camera details are removed from every photo you upload.</T>
      <Card><T size={13}>{notice.replace(/[>|*#]/g, " ").replace(/-{3,}/g, "").replace(/\s+\n/g, "\n").trim().slice(0, 1500)}</T></Card>
      <Button title="Read Terms of Service" onPress={() => open("terms")} />
      <Button title="Read Privacy Policy" onPress={() => open("privacy")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Switch value={agree} onValueChange={setAgree} accessibilityLabel="Agree to Terms and Privacy Policy" />
        <View style={{ flex: 1 }}><T>I agree to the Terms of Service (v{st.terms.current}) and Privacy Policy (v{st.privacy.current}).</T></View>
      </View>
      {st.training.current && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Switch value={training} onValueChange={setTraining} accessibilityLabel="Allow uploads to improve detection" />
          <View style={{ flex: 1 }}><T size={14}>Optional: let my future uploads help improve counterfeit detection. Saying no never limits features.</T></View>
        </View>
      )}
      <Button primary title="Agree and continue" busy={busy} disabled={!agree} onPress={async () => {
        setBusy(true);
        try {
          await api("/api/consent", { method: "POST", headers: { "x-client": "mobile" }, json: { terms: st.terms.current, privacy: st.privacy.current, ...(st.training.current && !st.training.granted ? { training } : {}) } });
          router.replace("/");
        } catch (e: any) { Alert.alert("Consent", e.message); setSt(await api("/api/consent")); } finally { setBusy(false); }
      }} />
      <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
