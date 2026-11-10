import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Share, View } from "react-native";
import { api } from "../../lib/api";
import { ASSESS, Button, Card, STATUS, T, useTheme } from "../../lib/ui";

export default function SessionReport() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [s, setS] = useState<any>(null);
  const [narrative, setNarrative] = useState<any>(null);
  const [market, setMarket] = useState<any>(null);
  const load = useCallback(async () => {
    const x = await api(`/api/sessions/${id}`);
    setS(x);
    if (x.report?.narrative) setNarrative(x.report.narrative);
    api(`/api/sessions/${id}/market`).then(setMarket).catch(() => setMarket(null));
  }, [id]);
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
          {r.quickSummary && (
            <Card>
              <T bold size={16}>{r.quickSummary.headline}</T>
              {[["Verified", r.quickSummary.verified, t.ok], ["Looks inconsistent", r.quickSummary.inconsistent.map((x: any) => `${x.severity.toUpperCase()}: ${x.text}`), t.bad], ["Can't see from these photos", r.quickSummary.cantSee, t.muted], ["Ask / photograph next", r.quickSummary.askNext, t.accent]].map(([title, items, color]: any) => (
                <View key={title} style={{ marginTop: 6 }}>
                  <T bold size={13} color={color}>{title}</T>
                  {items.length ? items.map((x: string) => <T key={x} size={14}>• {x}</T>) : <T muted size={13}>—</T>}
                </View>
              ))}
              {r.quickSummary.deepCheckRecommended && <Button primary title="Start deep check (free re-analysis)" onPress={() => router.push({ pathname: "/scan", params: { session: id, deep: "1" } })} />}
            </Card>
          )}
          <Card>
            <T muted size={13}>Overall assessment</T>
            <T size={19} bold color={tone(ASSESS[r.engine.assessment].tone)}>{ASSESS[r.engine.assessment].label}</T>
            <T muted size={13}>Evidence quality: {r.engine.evidenceQuality.level}</T>
            {r.engine.evidenceQuality.reasons.map((x: string) => <T key={x} muted size={13}>• {x}</T>)}
          </Card>
          {r.engine.retakeRequests?.length > 0 && (
            <Card>
              <T bold>Improve this report</T>
              <T muted size={13}>Adding these and re-analyzing uses no extra credit.</T>
              {r.engine.retakeRequests.map((q: any) => (
                <View key={q.role + q.reason} style={{ gap: 4, marginTop: 8 }}>
                  <T size={14}>{q.reason} {q.guidance}</T>
                  <Button title="Add this capture" onPress={() => router.push({ pathname: "/scan", params: { session: id, role: q.role } })} />
                </View>
              ))}
            </Card>
          )}
          {r.engine.physicalMatch?.map((pm: any) => (
            <Card key={pm.side}>
              <T bold>Same physical card? ({pm.side})</T>
              <T color={pm.verdict === "supported" ? t.ok : pm.verdict === "conflicting" ? t.bad : t.warn}>{pm.summary}</T>
            </Card>
          ))}
          <Card>
            <T bold>Plain-language explanation</T>
            {narrative ? <T size={14}>{narrative.text}</T> : <Button title="Explain this report (Pro)" onPress={async () => { try { setNarrative((await api(`/api/sessions/${id}/narrative`, { method: "POST" })).narrative); } catch (e: any) { Alert.alert("Explanation", e.message); } }} />}
            {narrative?.source === "ai" && <T muted size={12}>AI-assisted from the findings; it cannot change them.</T>}
          </Card>
          {market?.value && (
            <Card>
              <T bold>Market value{market.value.gradeLabel ? ` · ${market.value.gradeLabel}` : ""} (if genuine)</T>
              {market.value.estimateCents != null
                ? <T size={20} bold>${(market.value.estimateCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</T>
                : <T muted>No estimate yet</T>}
              {r.engine.assessment === "high_risk_inconsistencies" && <T color={t.bad} size={13}>Applies only if genuine — the findings above suggest the real value may be far lower.</T>}
              <T muted size={12}>{market.value.note} Add comparable sales on the website.</T>
            </Card>
          )}
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
