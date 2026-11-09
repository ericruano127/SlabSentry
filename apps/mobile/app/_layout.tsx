import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { needsMfa } from "../lib/mfa";
import { initPurchases, logoutPurchases } from "../lib/purchases";
import { useTheme } from "../lib/ui";

export default function Root() {
  const t = useTheme();
  const seg = useSegments();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session === undefined) return;
    const inAuth = seg[0] === "login";
    if (!session) {
      if (!inAuth) router.replace("/login");
      logoutPurchases();
      return;
    }
    (async () => {
      // 2FA step first (login screen shows the code entry), then required consent.
      if (await needsMfa()) return void (!inAuth && router.replace("/login"));
      const consent = await api("/api/consent").catch(() => null);
      if (consent?.required) { if (seg[0] !== "consent") router.replace("/consent"); return; }
      if (inAuth || seg[0] === "consent") router.replace("/");
      initPurchases(session.user.id).catch(() => {});
    })();
  }, [session, seg]);
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="index" options={{ title: "SlabGuard" }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="consent" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="scan" options={{ title: "Scan slab" }} />
        <Stack.Screen name="session/[id]" options={{ title: "Report" }} />
        <Stack.Screen name="paywall" options={{ title: "Plans", presentation: "modal" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
      </Stack>
    </>
  );
}
