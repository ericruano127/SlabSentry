"use client";
import { useEffect, useRef, useState } from "react";
import { analyzeFrame, CAPTURE_TIMING, hintsFor, toFrame, type CaptureTarget, type Frame, type Hint } from "@slabguard/core/capture";

/**
 * Live camera with real-time framing guidance (runs on-device, nothing is uploaded until capture).
 * Checks every ~250ms on a downscaled frame: sharpness (Laplacian variance), exposure, glare.
 * Capture is enabled once the frame has been steady and sharp for ~0.75s.
 * "video" mode records a short tilt clip with MediaRecorder (no liveness claim is made).
 */
const W = 240;

export function LiveCamera({ mode, label, onCapture, onClose, target = "slab" }: { mode: "photo" | "video"; label: string; onCapture: (b: Blob, name: string) => void; onClose: () => void; target?: CaptureTarget }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recording, setRecording] = useState(0);
  const steady = useRef(0);
  const prev = useRef<Frame | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number; w: number; h: number } | null>(null);
  const [auto, setAuto] = useState(true);
  const autoRef = useRef(true);
  const captured = useRef(false);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        stream.current = s;
        video.current!.srcObject = s;
        video.current!.play().catch(() => {});
        timer = setInterval(() => {
          const v = video.current, c = canvas.current;
          if (!v || !c || !v.videoWidth) return;
          const h = Math.round((W * v.videoHeight) / v.videoWidth);
          c.width = W; c.height = h;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, W, h);
          const f = toFrame(ctx.getImageData(0, 0, W, h).data, W, h);
          const checks = analyzeFrame(f, prev.current);
          prev.current = f;
          const { hints: hs, ready: ok } = hintsFor(checks, target);
          if (v.videoWidth < 1600) hs.push({ key: "res", ok: true, text: `Camera ${v.videoWidth}px — fine details may be inconclusive` });
          steady.current = ok ? steady.current + 1 : 0;
          setReady(steady.current >= CAPTURE_TIMING.readyAfter);
          setHints(hs);
          setBox(checks.box ? { ...checks.box, w: W, h } : null);
          // Auto-capture after ~1 s of passing checks (photo mode only, once).
          if (mode === "photo" && autoRef.current && steady.current >= CAPTURE_TIMING.autoAfter && !captured.current) { captured.current = true; snap(); }
        }, CAPTURE_TIMING.intervalMs);
      })
      .catch(() => setErr("Camera unavailable. Allow camera access, or use “Upload photo” instead."));
    return () => {
      clearInterval(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const v = video.current!;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(b, "capture.jpg"), "image/jpeg", 0.95);
  }

  function record() {
    const s = stream.current!;
    const type = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(s, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => onCapture(new Blob(chunks, { type: rec.mimeType }), rec.mimeType.includes("mp4") ? "tilt.mp4" : "tilt.webm");
    rec.start();
    let left = 4;
    setRecording(left);
    const t = setInterval(() => {
      left -= 1;
      setRecording(left);
      if (left <= 0) (clearInterval(t), rec.stop());
    }, 1000);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`${label} camera`} style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <video ref={video} playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        {box && target === "slab" && (
          <svg aria-hidden viewBox={`0 0 ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="none" stroke={ready ? "#4ade80" : "#fbbf24"} strokeWidth={1.5} />
          </svg>
        )}
        {/* Slab-shaped framing guide (holder ≈ 0.62 aspect) */}
        <div aria-hidden style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", height: "82%", aspectRatio: mode === "video" ? "1.6" : "0.62", border: `3px solid ${ready ? "#4ade80" : "rgba(255,255,255,.7)"}`, borderRadius: 12 }} />
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", flexWrap: "wrap", gap: 6 }} aria-live="polite">
          <span className="pill" style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}>{label}</span>
          {hints.map((h) => <span key={h.text} className="pill" style={{ background: h.ok ? "rgba(31,138,76,.85)" : "rgba(180,35,24,.85)", color: "#fff" }}>{h.text}</span>)}
        </div>
        {err && <div className="banner bad" style={{ position: "absolute", bottom: 90, left: 12, right: 12 }}>{err}</div>}
        {mode === "video" && <p style={{ position: "absolute", bottom: 90, left: 0, right: 0, textAlign: "center", color: "#fff" }}>{recording ? `Slowly tilt the slab… ${recording}` : "Frame the label, then tilt the slab slowly (~30°) for 4 seconds under one light."}</p>}
      </div>
      <canvas ref={canvas} hidden />
      <div className="row" style={{ padding: 16, justifyContent: "center", gap: 16, background: "#000" }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        {mode === "photo" && (
          <label className="row small" style={{ color: "#fff", gap: 6 }}>
            <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); autoRef.current = e.target.checked; }} style={{ width: 20, minHeight: 20 }} /> Auto-capture
          </label>
        )}
        {mode === "photo"
          ? <button className="btn primary" disabled={!ready} onClick={snap} aria-label="Capture photo">{ready ? "Capture" : "Getting ready…"}</button>
          : <button className="btn primary" disabled={!!recording || !!err} onClick={record}>{recording ? "Recording…" : "Record 4s tilt"}</button>}
      </div>
    </div>
  );
}
