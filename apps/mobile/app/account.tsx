import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, ScrollView } from "react-native";
import { api, type Me } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Button, Card, T } from "../lib/ui";

export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { api<Me>("/api/me").then(setMe); }, []);
  const u = me?.usage;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card>
        <T bold>{me?.user.email}</T>
        {u && <T>{u.planName}{u.subscriptionProvider ? ` · via ${{ stripe: "web", app_store: "App Store", play_store: "Google Play", manual: "admin" }[u.subscriptionProvider]}` : ""}</T>}
      </Card>
      <Button title="Plans & restore purchases" onPress={() => router.push("/paywall")} />
      {u?.subscriptionProvider && u.subscriptionProvider !== "stripe" && <Button title="Manage store subscription" onPress={() => Linking.openURL(Platform.OS === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions")} />}
      <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
      <Button title="Sign out of all devices" onPress={() => supabase.auth.signOut({ scope: "global" })} />
      <Button title="Delete account" onPress={() => Alert.alert("Delete account?", "This permanently deletes your account, photos and reports. Store subscriptions must be canceled in the store.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => { const r = await api("/api/account", { method: "DELETE", json: { confirm: "DELETE" } }); if (r.storeSubscriptionsNote) Alert.alert("Account deleted", r.storeSubscriptionsNote); await supabase.auth.signOut(); } },
      ])} />
    </ScrollView>
  );
}
