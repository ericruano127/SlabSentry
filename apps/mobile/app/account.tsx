import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Switch, View } from "react-native";
import { config } from "../lib/config";
import { api, type Me } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Button, Card, T } from "../lib/ui";

export default function Account() {
  const [me, setMe] = useState<(Me & { consent?: any }) | null>(null);
  const load = () => api<Me>("/api/me").then(setMe);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => { load(); api("/api/releases").then((r) => setVersion(r.current)).catch(() => {}); }, []);
  const u = me?.usage;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card>
        <T bold>{me?.user.email}</T>
        {u && <T>{u.planName}{u.subscriptionProvider ? ` · via ${{ stripe: "web", app_store: "App Store", play_store: "Google Play", manual: "admin" }[u.subscriptionProvider]}` : ""}</T>}
      </Card>
      <Card>
        <T bold>Privacy</T>
        <T muted size={13}>Location and camera details are removed from every photo on upload. We don't sell or share your data.</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Switch value={!!me?.consent?.training.granted} accessibilityLabel="Use my uploads to improve detection" onValueChange={async (v) => {
            try { await api("/api/consent", { method: "PATCH", headers: { "x-client": "mobile" }, json: { training: v } }); load(); } catch (e: any) { Alert.alert("Privacy", e.message); }
          }} />
          <View style={{ flex: 1 }}><T size={14}>Use my future uploads to improve counterfeit detection (optional)</T></View>
        </View>
        <Button title="Download my data (opens website)" onPress={() => Linking.openURL(`${config.apiUrl}/account#privacy`)} />
        <Button title="Privacy Policy" onPress={() => Linking.openURL(`${config.apiUrl}/legal/privacy`)} />
      </Card>
      <Button title="Plans & restore purchases" onPress={() => router.push("/paywall")} />
      {u?.subscriptionProvider && u.subscriptionProvider !== "stripe" && <Button title="Manage store subscription" onPress={() => Linking.openURL(Platform.OS === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions")} />}
      <Button title={`What's new${version ? ` · v${version}` : ""}`} onPress={() => Linking.openURL(`${config.apiUrl}/whats-new`)} />
      <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
      <Button title="Sign out of all devices" onPress={() => supabase.auth.signOut({ scope: "global" })} />
      <Button title="Delete account" onPress={() => Alert.alert("Delete account?", "This permanently deletes your account, photos and reports. Store subscriptions must be canceled in the store.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => { const r = await api("/api/account", { method: "DELETE", json: { confirm: "DELETE" } }); if (r.storeSubscriptionsNote) Alert.alert("Account deleted", r.storeSubscriptionsNote); await supabase.auth.signOut(); } },
      ])} />
      {/* For bug reports (docs/MANUAL_TEST_PLAN.md): which build this is and where it points. */}
      <View style={{ alignItems: "center" }}><T muted size={12}>
        {`App ${config.appVersion}${config.variant !== "production" ? ` · ${config.variant} build` : ""}${config.variant !== "production" && config.apiUrl ? ` · ${config.apiUrl.replace(/^https?:\/\//, "")}` : ""}`}
      </T></View>
    </ScrollView>
  );
}
