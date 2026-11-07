import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, ScrollView, TextInput, View } from "react-native";
import { api, ApiError, uploadPhoto } from "../lib/api";
import { Button, Card, T, useTheme } from "../lib/ui";

type Step = { role: string; title: string; hint: string; optional?: boolean; multiple?: boolean };
const STEPS: Step[] = [
  { role: "front", title: "Front of slab", hint: "Whole slab, all four edges in frame, straight on, no glare." },
  { role: "back", title: "Back of slab", hint: "Flip the slab. Same framing." },
  { role: "label_closeup", title: "Label close-up", hint: "Fill the frame with the label; number and QR sharp." },
  { role: "tilt_frame", title: "Tilt sequence (optional)", hint: "3–5 label photos while gently tilting under one light.", optional: true, multiple: true },
  { role: "backlit", title: "Backlit label (optional, PSA)", hint: "Light behind the label, same framing as the close-up.", optional: true },
  { role: "edge", title: "Holder edges (optional)", hint: "Close-ups of the holder sides and seams.", optional: true, multiple: true },
  { role: "reference_front", title: "Reference image (optional)", hint: "If the grader's cert page shows images, add the front image. It will be labeled user-supplied — never as retrieved from the grader. (PSA images are fetched automatically when our PSA integration is enabled.)", optional: true },
];
const ATTESTATIONS = ["Saved from the grader's official cert page", "Screenshot of the grader's official cert page", "Other source (marketplace, seller, etc.)"];
const askAttestation = () => new Promise<string | null>((resolve) =>
  Alert.alert("Where is this reference image from?", undefined, [...ATTESTATIONS.map((a) => ({ text: a, onPress: () => resolve(a) })), { text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) }]));

export default function Scan() {
  const t = useTheme();
  const params = useLocalSearchParams<{ session?: string }>();
  const [mode, setMode] = useState<"in_hand" | "online_listing" | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(params.session ?? null);
  const [i, setI] = useState(0);
  const [shots, setShots] = useState<Record<string, { uri: string; quality: any }[]>>({});
  const [busy, setBusy] = useState(false);
  const [grader, setGrader] = useState("");
  const [cert, setCert] = useState("");
  const [phase, setPhase] = useState<"capture" | "confirm" | "analyze">("capture");

  useEffect(() => { if (params.session) setMode("in_hand"); }, [params.session]);

  async function start(m: "in_hand" | "online_listing") {
    const r = await api<{ id: string }>("/api/sessions", { method: "POST", json: { mode: m } });
    setSessionId(r.id);
    setMode(m);
  }

  async function capture(step: Step, fromLibrary: boolean) {
    const attestation = step.role.startsWith("reference") ? await askAttestation() : undefined;
    if (attestation === null) return;
    const opts: ImagePicker.ImagePickerOptions = { quality: 0.92, exif: false, allowsMultipleSelection: step.multiple && fromLibrary };
    if (!fromLibrary) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera", "Camera permission is needed to photograph the slab. You can also choose a saved photo.");
    }
    const res = fromLibrary ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts);
    if (res.canceled) return;
    setBusy(true);
    try {
      for (const a of res.assets) {
        const r = await uploadPhoto(sessionId!, step.role, a.uri, attestation);
        setShots((s) => ({ ...s, [step.role]: [...(step.multiple ? s[step.role] ?? [] : []), { uri: a.uri, quality: r.image.quality }] }));
      }
    } catch (e: any) {
      Alert.alert("Upload", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function readLabel() {
    setBusy(true);
    try {
      const r = await api(`/api/sessions/${sessionId}/extract`, { method: "POST" });
      setGrader(r.graders[0]?.grader ?? "");
      setCert(r.candidates[0]?.value ?? "");
    } catch {
      /* user types it */
    } finally {
      setBusy(false);
      setPhase("confirm");
    }
  }

  async function analyze() {
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}`, { method: "PATCH", json: { grader: grader || undefined, certNumber: cert || undefined, certConfirmed: !!cert } });
      await api(`/api/sessions/${sessionId}/analyze`, { method: "POST" });
      router.replace(`/session/${sessionId}`);
    } catch (e) {
      const b = e instanceof ApiError ? e.body : null;
      if (b?.error === "limit_reached") Alert.alert("Out of verifications", b.message, [{ text: "Later" }, { text: "See plans", onPress: () => router.push("/paywall") }]);
      else if (b?.error === "retake_needed") Alert.alert("Retake needed", b.problems.flatMap((p: any) => p.issues.map((x: any) => x.guidance)).join("\n"));
      else Alert.alert("Analysis", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, color: t.text, backgroundColor: t.surface, minHeight: 48 } as const;

  if (!mode) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card><T size={18} bold>In hand</T><T muted>You have the slab. Use the camera for guided captures.</T><Button primary title="Start in-hand scan" onPress={() => start("in_hand")} /></Card>
        <Card><T size={18} bold>Online listing</T><T muted>Screen a seller's photos. We can't confirm the seller has the slab or that photos are live.</T><Button title="Screen listing photos" onPress={() => start("online_listing")} /></Card>
      </ScrollView>
    );
  }

  if (phase === "confirm" || phase === "analyze") {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card style={{ gap: 10 }}>
          <T size={18} bold>Confirm certification</T>
          <T muted size={13}>Check each digit against the label (0/O, 1/7, 5/S are easy to confuse).</T>
          <TextInput style={input} placeholder="Grader (PSA, CGC, BGS, SGC, TAG, AGS)" placeholderTextColor={t.muted} autoCapitalize="characters" value={grader} onChangeText={setGrader} accessibilityLabel="Grading company" />
          <TextInput style={input} placeholder="Certification number" placeholderTextColor={t.muted} autoCapitalize="characters" value={cert} onChangeText={setCert} accessibilityLabel="Certification number" />
        </Card>
        <T muted size={13}>Uses 1 verification, charged only when your report is delivered. Retakes in this session are free.</T>
        <Button primary title="Analyze slab" onPress={analyze} busy={busy} disabled={!["PSA", "CGC", "BGS", "SGC", "TAG", "AGS"].includes(grader.toUpperCase())} />
        <Button title="Back to photos" onPress={() => setPhase("capture")} />
      </ScrollView>
    );
  }

  const step = STEPS[i];
  const mine = shots[step.role] ?? [];
  const last = mine[mine.length - 1];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <T muted size={13}>Step {i + 1} of {STEPS.length}</T>
      <Card style={{ gap: 10 }}>
        <T size={18} bold>{step.title}</T>
        <T muted>{step.hint}</T>
        {last && <Image source={{ uri: last.uri }} style={{ width: "100%", height: 260, borderRadius: 10 }} resizeMode="contain" accessibilityLabel={`${step.title} preview`} />}
        {last?.quality?.issues?.map((q: any) => <T key={q.issue} color={q.severity === "major" ? t.bad : t.warn}>{q.severity === "major" ? "Retake needed: " : "Tip: "}{q.guidance}</T>)}
        {last?.quality?.ok && !last.quality.issues.length && <T color={t.ok}>✓ Photo looks good</T>}
        {mode === "in_hand" && !step.role.startsWith("reference") && <Button primary={!last} title={last ? (step.multiple ? `Add another (${mine.length})` : "Retake") : "Take photo"} onPress={() => capture(step, false)} busy={busy} />}
        <Button title={mode === "in_hand" ? "Choose from library" : "Upload seller photo"} onPress={() => capture(step, true)} busy={busy} />
      </Card>
      <T muted size={13}>Never bend, open, heat or scrape a slab. Photos and retakes don't use credits.</T>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Back" onPress={() => setI(Math.max(0, i - 1))} disabled={i === 0} /></View>
        <View style={{ flex: 1 }}>
          {i < STEPS.length - 1
            ? <Button primary title={step.optional && !last ? "Skip" : "Next"} onPress={() => (step.role === "label_closeup" ? readLabel().then(() => { setPhase("capture"); setI(i + 1); }) : setI(i + 1))} disabled={!step.optional && !last && step.role !== "back"} />
            : <Button primary title="Review" onPress={() => (cert ? setPhase("confirm") : readLabel())} />}
        </View>
      </View>
    </ScrollView>
  );
}
