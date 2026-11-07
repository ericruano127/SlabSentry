import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, type Me } from "../lib/api";
import { ASSESS, Button, Card, T, useTheme } from "../lib/ui";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

export default function Dashboard() {
  const t = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, s] = await Promise.all([api<Me>("/api/me"), api<{ sessions: any[] }>("/api/sessions")]);
      setMe(m);
      setSessions(s.sessions);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const u = me?.usage;
  const paid = u && u.planId !== "free";
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {me?.welcome && u?.freeUsed === 0 && !paid && <Card style={{ backgroundColor: t.surface }}><T bold>Welcome! Your first three slab verifications are free. No credit card required.</T></Card>}
      <T size={24} bold>Welcome back</T>
      {u && (
        <Card>
          <T muted size={13}>Current plan</T>
          <T size={22} bold>{u.planName}</T>
          <T>Verification usage: {paid ? `${u.periodUsed} / ${u.periodAllowance} this month` : `${u.freeUsed} / ${u.freeGranted} free`}</T>
          <T size={20} bold>Available: {u.totalRemaining} remaining scans</T>
          {paid && <T muted size={13}>{u.willCancel ? `Plan ends ${fmt(u.accessEndsAt)}` : `Renewal date: ${fmt(u.renewsAt)}`}</T>}
          {!paid && u.freeRemaining === 0 && <T color={t.warn}>You've used your free verifications. Your reports stay available.</T>}
          {paid && u.periodRemaining <= 3 && <T color={t.warn}>Only {u.periodRemaining} left this month.</T>}
        </Card>
      )}
      <Button primary title="Scan new slab" onPress={() => router.push("/scan")} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Button title={paid ? "Manage plan" : "Upgrade plan"} onPress={() => router.push("/paywall")} /></View>
        <View style={{ flex: 1 }}><Button title="Account" onPress={() => router.push("/account")} /></View>
      </View>
      <T bold size={17}>Verification history</T>
      {sessions.map((s) => (
        <Pressable key={s.id} accessibilityRole="button" onPress={() => router.push(s.status === "draft" ? { pathname: "/scan", params: { session: s.id } } : `/session/${s.id}`)}>
          <Card>
            <T bold>{s.title ?? (s.cert_number ? `${s.grader ?? ""} ${s.cert_number}` : "Draft scan")}</T>
            <T muted size={13}>{s.overall_assessment ? ASSESS[s.overall_assessment]?.label : s.status} · {fmt(s.created_at)}</T>
          </Card>
        </Pressable>
      ))}
      {!sessions.length && <T muted>No scans yet.</T>}
    </ScrollView>
  );
}
