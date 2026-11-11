import { analyzeFrame, CAPTURE_TIMING, fromLuma, hintsFor, toFrame, type CaptureTarget, type Frame as GrayFrame, type FrameChecks, type Hint } from "@slabguard/core/capture";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking, Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Camera, CommonResolutions, useCameraDevice, useCameraPermission, useFrameOutput, usePhotoOutput, useVideoOutput,
  type CameraRef, type Frame, type Recorder,
} from "react-native-vision-camera";
import { scheduleOnRN } from "react-native-worklets";

/**
 * Native live camera with real-time framing guidance — the same checks as the web camera
 * (`@slabguard/core/capture`), run on the camera thread by a VisionCamera frame processor.
 * Nothing leaves the phone until the photo is taken. Checks run about 4×/s on a small luminance
 * frame: steadiness, focus, light, glare and, for whole-slab shots, all-edges-in-frame, size,
 * straight-on angle and label sharpness. Capture unlocks after ~0.75 s of passing checks and
 * auto-capture fires after ~1 s (photo mode, once; can be turned off).
 * Video mode records a 4 s tilt clip (no liveness claim is made).
 */
export type LiveCaptureResult = { uri: string; mimeType: string };

type Props = {
  visible: boolean;
  mode: "photo" | "video";
  target: CaptureTarget;
  label: string;
  onCapture: (r: LiveCaptureResult) => void;
  onClose: () => void;
  /** Use the system camera instead (camera unavailable, or the user prefers it). */
  onFallback: () => void;
};

type Analysis = { checks: FrameChecks; w: number; h: number };
const TILT_SECONDS = 4;

/** Frame processor body. Runs on the camera thread (worklet); state lives on that runtime's global. */
function analyze(frame: Frame): Analysis | null {
  "worklet";
  const g = globalThis as any;
  if (!g.__slabguardCapture) g.__slabguardCapture = { last: 0, prev: null as GrayFrame | null };
  const st = g.__slabguardCapture;
  const now = Date.now();
  if (now - st.last < CAPTURE_TIMING.intervalMs) return null;
  // A long gap means the camera was closed and reopened: don't compare against a stale frame
  // (it would read as movement and briefly show "Hold steady").
  if (now - st.last > 2000) st.prev = null;
  st.last = now;
  let f: GrayFrame | null = null;
  const fmt = frame.pixelFormat;
  if (fmt.startsWith("yuv") && fmt.includes("8-bit") && frame.isPlanar) {
    const y = frame.getPlanes()[0];
    f = fromLuma(new Uint8Array(y.getPixelBuffer()), y.width, y.height, y.bytesPerRow, 240, fmt.endsWith("-video"));
  } else if (fmt === "rgb-bgra-8-bit" || fmt === "rgb-rgba-8-bit") {
    f = toFrame(new Uint8Array(frame.getPixelBuffer()), frame.width, frame.height, frame.bytesPerRow, 240);
  }
  if (!f) return null; // unsupported format (e.g. 10-bit): no guidance, manual capture still works
  const checks = analyzeFrame(f, st.prev);
  st.prev = f;
  return { checks, w: f.w, h: f.h };
}

export function LiveCamera({ visible, mode, target, label, onCapture, onClose, onFallback }: Props) {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const cam = useRef<CameraRef>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [ready, setReady] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const steady = useRef(0);
  const captured = useRef(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const recorder = useRef<Recorder | null>(null);

  useEffect(() => {
    if (!visible) return;
    steady.current = 0;
    captured.current = false;
    setReady(false); setHints([]); setAnalysis(null); setErr(null); setRecording(0); setBusy(false);
    if (!hasPermission && canRequestPermission) requestPermission();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.UHD_4_3, qualityPrioritization: "quality", quality: 0.92 });
  const videoOutput = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio: false, fileType: "mp4" });

  const takePhoto = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const p = await photoOutput.capturePhotoToFile({ enableShutterSound: true }, {});
      onCapture({ uri: p.filePath.startsWith("file://") ? p.filePath : `file://${p.filePath}`, mimeType: "image/jpeg" });
    } catch (e) {
      setErr(`Couldn't take the photo (${(e as Error).message}). Try again or use the system camera.`);
      captured.current = false;
    } finally {
      setBusy(false);
    }
  }, [busy, photoOutput, onCapture]);

  // Runs on the JS thread with each analysis result from the camera thread.
  const onAnalysis = useCallback((a: Analysis) => {
    const { hints: hs, ready: ok } = hintsFor(a.checks, target);
    steady.current = ok ? steady.current + 1 : 0;
    const nowReady = steady.current >= CAPTURE_TIMING.readyAfter;
    setReady((was) => {
      if (nowReady && !was) AccessibilityInfo.announceForAccessibility("Ready to capture");
      return nowReady;
    });
    setHints(hs);
    setAnalysis(a);
    if (mode === "photo" && autoRef.current && steady.current >= CAPTURE_TIMING.autoAfter && !captured.current) {
      captured.current = true;
      takePhoto();
    }
  }, [target, mode, takePhoto]);
  const onAnalysisRef = useRef(onAnalysis);
  onAnalysisRef.current = onAnalysis;
  const deliver = useCallback((a: Analysis) => onAnalysisRef.current(a), []);

  const frameOutput = useFrameOutput({
    targetResolution: CommonResolutions.VGA_4_3,
    pixelFormat: "yuv",
    enablePhysicalBufferRotation: true, // upright buffer, so "top of the slab" means the label
    dropFramesWhileBusy: true,
    onFrame(frame) {
      "worklet";
      try {
        const a = analyze(frame);
        if (a) scheduleOnRN(deliver, a);
      } finally {
        frame.dispose();
      }
    },
  });

  async function recordTilt() {
    setErr(null);
    try {
      const rec = await videoOutput.createRecorder({ maxDuration: TILT_SECONDS });
      recorder.current = rec;
      let left = TILT_SECONDS;
      setRecording(left);
      const t = setInterval(() => { left -= 1; setRecording(Math.max(left, 0)); if (left <= 0) clearInterval(t); }, 1000);
      await rec.startRecording(
        (filePath) => { clearInterval(t); setRecording(0); onCapture({ uri: filePath.startsWith("file://") ? filePath : `file://${filePath}`, mimeType: "video/mp4" }); },
        (e) => { clearInterval(t); setRecording(0); setErr(`Recording failed (${e.message}).`); },
      );
    } catch (e) {
      setRecording(0);
      setErr(`Recording failed (${(e as Error).message}).`);
    }
  }

  function close() {
    recorder.current?.cancelRecording().catch(() => {});
    onClose();
  }

  const aspect = analysis ? analysis.w / analysis.h : 3 / 4;
  const box = target === "slab" ? analysis?.checks.box : null;
  const tint = ready ? "#4ade80" : "#fbbf24";

  let body: React.ReactNode;
  if (!hasPermission) {
    body = (
      <Center>
        <Text style={s.msg}>Camera access is needed to photograph the slab.</Text>
        {canRequestPermission
          ? <Btn title="Allow camera" primary onPress={() => requestPermission()} />
          : <Btn title="Open Settings" primary onPress={() => Linking.openSettings()} />}
        <Btn title="Choose a saved photo instead" onPress={onClose} />
      </Center>
    );
  } else if (!device) {
    body = (
      <Center>
        <Text style={s.msg}>No back camera found.</Text>
        <Btn title="Use system camera" primary onPress={onFallback} />
      </Center>
    );
  } else {
    body = (
      <View style={s.stage}>
        <View style={[s.preview, { aspectRatio: aspect }]}>
          <Camera
            ref={cam}
            style={StyleSheet.absoluteFill}
            isActive={visible}
            device={device}
            outputs={mode === "photo" ? [photoOutput, frameOutput] : [videoOutput, frameOutput]}
            resizeMode="cover"
            enableNativeTapToFocusGesture
            enableNativeZoomGesture
            onError={(e) => setErr(`Camera error: ${e.message}`)}
          />
          {/* Slab-shaped guide (holder ≈ 0.62 aspect) or a wide frame for tilt videos. */}
          <View pointerEvents="none" style={[s.guide, mode === "video" ? { aspectRatio: 1.6, width: "90%" } : { aspectRatio: 0.62, height: "86%" }, { borderColor: ready ? "#4ade80" : "rgba(255,255,255,.7)" }]} />
          {box && analysis && (
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={{ position: "absolute", borderWidth: 2, borderColor: tint, left: `${(box.x0 / analysis.w) * 100}%`, top: `${(box.y0 / analysis.h) * 100}%`, width: `${((box.x1 - box.x0) / analysis.w) * 100}%`, height: `${((box.y1 - box.y0) / analysis.h) * 100}%` }} />
          )}
        </View>
        <View style={s.hints} accessibilityLiveRegion="polite">
          <Pill text={label} bg="rgba(0,0,0,.6)" />
          {hints.map((h) => <Pill key={h.key} text={h.text} bg={h.ok ? "rgba(21,112,60,.95)" : "rgba(180,35,24,.9)"} />)}
          {!analysis && <Pill text="Starting guidance…" bg="rgba(0,0,0,.6)" />}
        </View>
        {mode === "video" && (
          <Text style={s.caption}>{recording ? `Slowly tilt the slab… ${recording}` : `Frame the label, then tilt the slab slowly (~30°) for ${TILT_SECONDS} seconds under one light.`}</Text>
        )}
        {err && <Text style={s.err} accessibilityRole="alert">{err}</Text>}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <SafeAreaView style={s.root}>
        {body}
        <View style={s.bar}>
          <Btn title="Cancel" onPress={close} />
          {hasPermission && device && mode === "photo" && (
            <View style={s.autoRow}>
              <Switch value={auto} onValueChange={setAuto} accessibilityLabel="Auto-capture" />
              <Text style={s.autoText}>Auto</Text>
            </View>
          )}
          {hasPermission && device && (mode === "photo"
            ? <Btn primary title={busy ? "Saving…" : ready ? "Capture" : "Getting ready…"} disabled={!ready || busy} onPress={() => { captured.current = true; takePhoto(); }} label="Capture photo" />
            : <Btn primary title={recording ? "Recording…" : `Record ${TILT_SECONDS}s tilt`} disabled={!!recording} onPress={recordTilt} />)}
        </View>
        {hasPermission && device && <Pressable onPress={onFallback} accessibilityRole="button" style={s.fallback}><Text style={s.fallbackText}>Having trouble? Use the system camera</Text></Pressable>}
      </SafeAreaView>
    </Modal>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>{children}</View>;
}
function Pill({ text, bg }: { text: string; bg: string }) {
  return <Text style={[s.pill, { backgroundColor: bg }]}>{text}</Text>;
}
function Btn({ title, onPress, primary, disabled, label }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; label?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!disabled }}
      style={[s.btn, primary && s.btnPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[s.btnText, primary && { color: "#04210f" }]}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1, justifyContent: "center", alignItems: "center" },
  preview: { width: "100%", maxHeight: "100%", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  guide: { position: "absolute", borderWidth: 3, borderRadius: 12 },
  hints: { position: "absolute", top: 8, left: 8, right: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { color: "#fff", fontSize: 13, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: "hidden" },
  caption: { position: "absolute", bottom: 12, left: 16, right: 16, color: "#fff", textAlign: "center", fontSize: 15 },
  err: { position: "absolute", bottom: 48, left: 16, right: 16, color: "#fff", backgroundColor: "rgba(180,35,24,.9)", padding: 10, borderRadius: 10 },
  msg: { color: "#fff", fontSize: 16, textAlign: "center" },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, padding: 14 },
  autoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  autoText: { color: "#fff", fontSize: 14 },
  btn: { minHeight: 48, minWidth: 96, paddingHorizontal: 18, borderRadius: 12, backgroundColor: "#262626", alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: "#4ade80" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fallback: { alignItems: "center", paddingBottom: 10, minHeight: 44, justifyContent: "center" },
  fallbackText: { color: "#a3a3a3", fontSize: 13, textDecorationLine: "underline" },
});
