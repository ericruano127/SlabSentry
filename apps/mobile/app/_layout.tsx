import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
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
    if (!session && !inAuth) router.replace("/login");
    if (session && inAuth) router.replace("/");
    if (session) initPurchases(session.user.id).catch(() => {});
    else logoutPurchases();
  }, [session, seg]);
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="index" options={{ title: "SlabGuard" }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ title: "Scan slab" }} />
        <Stack.Screen name="session/[id]" options={{ title: "Report" }} />
        <Stack.Screen name="paywall" options={{ title: "Plans", presentation: "modal" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
      </Stack>
    </>
  );
}
