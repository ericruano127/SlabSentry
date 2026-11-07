import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, Share } from "react-native";
import { api } from "../../lib/api";
import { ASSESS, Button, Card, STATUS, T, useTheme } from "../../lib/ui";

export default function SessionReport() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [s, setS] = useState<any>(null);
  const load = useCallback(async () => setS(await api(`/api/sessions/${id}`)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (s && (s.status === "queued" || s.status === "processing")) {
      const h = setTimeout(load, 2000);
      return () => clearTimeout(h);
    }
  }, [s, load]);
  if (!s) return <T>Loading…</T>;
  const r = s.report;
  const tone = (x: string) => (x === "ok" ? t.ok : x === "warn" ? t.warn : x === "bad" ? t.bad : t.muted);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <T size={20} bold>{s.title ?? "Verification"}</T>
      {(s.status === "queued" || s.status === "processing") && <Card><T>Analyzing your slab…</T></Card>}
      {s.status === "failed" && <Card><T color={t.bad}>{s.error}</T></Card>}
      {r && (
        <>
          <Card>
            <T muted size={13}>Overall assessment</T>
            <T size={19} bold color={tone(ASSESS[r.engine.assessment].tone)}>{ASSESS[r.engine.assessment].label}</T>
            <T muted size={13}>Evidence quality: {r.engine.evidenceQuality.level}</T>
            {r.engine.evidenceQuality.reasons.map((x: string) => <T key={x} muted size={13}>• {x}</T>)}
          </Card>
          <Card><T bold>Recommended next action</T>{r.engine.nextActions.map((a: string, n: number) => <T key={a}>{n + 1}. {a}</T>)}</Card>
          <Card>
            <T bold>Official verification</T>
            <T>{r.identification.graderName ?? "Grader ?"} · Cert {r.identification.certNumber ?? "—"}</T>
            <T muted size={13}>Record: {r.official.recordStatus.replace("_", " ")} · Reference: {r.official.imageAvailability.replace("_", " ")}</T>
            {r.official.lookupUrl && <Button title="Open official lookup" onPress={() => Linking.openURL(r.official.lookupUrl)} />}
          </Card>
          {r.engine.findings.map((f: any) => (
            <Card key={f.id}><T bold color={f.severity === "high" ? t.bad : t.warn}>{f.severity.toUpperCase()} · {f.summary}</T><T size={14}>{f.explanation}</T>{f.legitimateExplanations.length > 0 && <T muted size={13}>Could also be: {f.legitimateExplanations.join("; ")}</T>}</Card>
          ))}
          <Card>
            <T bold>Checks</T>
            {r.engine.observations.map((o: any) => <T key={o.id} size={14}><T bold size={14}>{STATUS[o.status]}</T> — {o.title}: {o.detail}</T>)}
          </Card>
          <T muted size={12}>{r.disclaimer}</T>
          <Button title="Share report link" onPress={async () => { const { url } = await api(`/api/sessions/${id}/share`, { method: "POST" }); Share.share({ message: url }); }} />
        </>
      )}
      <Button title="Add photos / retake (no extra credit)" onPress={() => router.push({ pathname: "/scan", params: { session: id } })} />
    </ScrollView>
  );
}
