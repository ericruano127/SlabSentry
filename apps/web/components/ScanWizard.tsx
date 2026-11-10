"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useApi, type Me } from "@/lib/client/hooks";
import { captureTargetFor } from "@slabguard/core/capture";
import { LiveCamera } from "./LiveCamera";
import { UpgradePrompt } from "./ui";

type Img = { id: string; role: string; quality: { ok: boolean; issues: { issue: string; severity: string; guidance: string }[] } | null };
type Session = { id: string; mode: string; category: string; grader: string | null; certNumber: string | null; certConfirmed: boolean; creditState: string; lockedCert: string | null; officialLookupUrl: string | null; images: (Img & { is_original: boolean })[]; references: { side: string; source: string }[] };

type LibCategory = { id: string; name: string; description: string; launchStatus: "supported" | "beta" | "planned"; subcategories: string[]; captureGuidance: { front: string; back: string; label: string; extras: { role: string; title: string; hint: string }[] } };
type LibGrader = { id: string; name: string; categories: string[]; status: string };
const SECURITY_TIPS: Record<string, string[]> = {
  PSA: ["Backlight: hold a phone flashlight behind the label and photograph the front — PSA documents an on/off LightHouse logo effect on newer labels.", "Older (pre-2017) labels don't have this feature; that's expected."],
  CGC: ["Tilt the slab slowly under one light so the holographic foil changes color; take 3–5 photos of the label.", "UV ink can't be checked with a phone camera."],
  TAG: ["Use TAG's official Proof authentication service for the Proof mark — we can't verify it from photos."],
};

/** Downscale only very large photos (keeps originals whenever they fit the upload limit). */
async function prepare(file: Blob): Promise<Blob> {
  if (file.type.startsWith("video/")) return file;
  if (file.size <= 14 * 1024 * 1024 && /jpe?g|png|webp/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 3200 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
}

function Capture({ label, hint, role, multiple, onUpload, images, attestation, inHand, highlight }: { label: string; hint: string; role: string; multiple?: boolean; onUpload: (role: string, f: Blob, att?: string, name?: string) => Promise<void>; images: Img[]; attestation?: string; inHand: boolean; highlight?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const isVideo = role === "tilt_video";
  const canLive = inHand && !role.startsWith("reference") && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const mine = images.filter((i) => i.role === role);
  const last = mine[mine.length - 1];
  return (
    <div className={`capture ${mine.length ? "has" : ""}`} style={highlight ? { borderColor: "var(--accent)", borderStyle: "solid" } : undefined}>
      {live && <LiveCamera mode={isVideo ? "video" : "photo"} target={captureTargetFor(role)} label={label} onClose={() => setLive(false)} onCapture={async (b, name) => { setLive(false); setBusy(true); try { await onUpload(role, b, attestation, name); } finally { setBusy(false); } }} />}
      <h3>{label}</h3>
      <p className="small muted">{hint}</p>
      <input ref={ref} type="file" accept={isVideo ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"} capture={inHand && !role.startsWith("reference") ? "environment" : undefined} multiple={multiple} hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          setBusy(true);
          try { for (const f of files) await onUpload(role, f, attestation); } finally { setBusy(false); }
        }} />
      <div className="row" style={{ justifyContent: "center" }}>
        {canLive && <button className="btn primary" disabled={busy} onClick={() => setLive(true)}>{isVideo ? "Record tilt video" : mine.length && !multiple ? "Retake with guide" : "Live camera"}</button>}
        <button className="btn" onClick={() => ref.current?.click()} disabled={busy || (role.startsWith("reference") && !attestation)}>
          {busy ? (isVideo ? "Extracting frames…" : "Checking photo…") : mine.length ? (multiple ? `Add more (${mine.length})` : isVideo ? "Replace video" : "Retake") : isVideo ? "Upload video" : inHand && !role.startsWith("reference") ? "Take photo" : "Upload photo"}
        </button>
      </div>
      {isVideo && last?.quality?.ok && <p className="small" style={{ color: "var(--ok)", marginTop: 8 }}>✓ {(last.quality as any).metrics?.distinctFrames} distinct frames extracted</p>}
      {!isVideo && last?.quality && (last.quality.ok && !last.quality.issues.length ? <p className="small" style={{ color: "var(--ok)", marginTop: 8 }}>✓ Photo looks good</p> :
        last.quality.issues.map((i) => <div key={i.issue} className={`issue ${i.severity}`} role="alert"><strong>{i.severity === "major" ? "Retake needed: " : "Tip: "}</strong>{i.guidance}</div>))}
      {isVideo && last?.quality && !last.quality.ok && last.quality.issues.map((i) => <div key={i.issue} className="issue major" role="alert">{i.guidance}</div>)}
      {last && !last.quality && <p className="small muted">Uploaded — quality will be checked before analysis.</p>}
    </div>
  );
}

export function ScanWizard() {
  const router = useRouter();
  const me = useApi<Me>("/api/me");
  const library = useApi<{ version: string; categories: LibCategory[]; graders: LibGrader[] }>("/api/library");
  const [categoryId, setCategoryId] = useState("sports_cards");
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<any>(null);
  const [extract, setExtract] = useState<any>(null);
  const [cert, setCert] = useState("");
  const [grader, setGrader] = useState("");
  const [att, setAtt] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusRole, setFocusRole] = useState<string | null>(null);
  // Tiered flow: quick scan by default (front, back, label, cert → analyze); deep check adds security
  // captures and a reference image, opted into here or requested by the report.
  const [deep, setDeep] = useState(false);
  const [gradeIn, setGradeIn] = useState("");
  const [askIn, setAskIn] = useState("");
  const [titleIn, setTitleIn] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const id = p.get("session");
    const role = p.get("role");
    const stepFor: Record<string, number> = { uv: 4, front: 1, back: 1, label_closeup: 2, tilt_frame: 4, tilt_video: 4, backlit: 4, edge: 4, security_closeup: 4, reference_front: 5, reference_back: 5 };
    const wantDeep = p.get("deep") === "1" || (!!role && (stepFor[role] ?? 1) >= 4);
    if (wantDeep) setDeep(true);
    if (id) api<Session>(`/api/sessions/${id}`).then((s) => { setSession(s); setCert(s.certNumber ?? ""); setGrader(s.grader ?? ""); setStep(role ? stepFor[role] ?? 1 : wantDeep ? 4 : 1); setFocusRole(role); });
  }, []);

  const inHand = session?.mode !== "online_listing";
  // Category data (capture guidance, graders) comes from the published reference library.
  const cat = library.data?.categories.find((c) => c.id === (session?.category ?? categoryId));
  const graderOptions = (library.data?.graders ?? []).filter((g) => !cat || g.categories.includes(cat.id));
  const guide = cat?.captureGuidance;
  const images = session?.images.filter((i) => i.is_original) ?? [];
  const refresh = async () => session && setSession(await api<Session>(`/api/sessions/${session.id}`));

  async function start(mode: string) {
    setErr(null);
    const { id } = await api<{ id: string }>("/api/sessions", { method: "POST", json: { mode, category: categoryId } });
    setSession(await api<Session>(`/api/sessions/${id}`));
    setStep(1);
  }
  async function upload(role: string, f: Blob, attestation?: string, name?: string) {
    setErr(null);
    const fd = new FormData();
    if (name === "capture.jpg") {
      // In-app live camera capture: attach a single-use code issued to this session.
      const { nonce } = await api(`/api/sessions/${session!.id}/capture-nonce`, { method: "POST" }).catch(() => ({ nonce: null }));
      if (nonce) fd.append("captureNonce", nonce);
    }
    fd.append("file", await prepare(f), name ?? (f as File).name ?? "upload");
    fd.append("role", role);
    if (attestation) fd.append("attestation", attestation);
    try { await api(`/api/sessions/${session!.id}/images`, { method: "POST", body: fd }); } catch (e) { setErr(e); }
    await refresh();
  }
  async function readLabel() {
    setBusy(true);
    try {
      const r = await api(`/api/sessions/${session!.id}/extract`, { method: "POST" });
      setExtract(r);
      if (!grader && r.graders[0]) setGrader(r.graders[0].grader);
      if (!cert && r.candidates[0]) setCert(r.candidates[0].value);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function confirmCert() {
    const src = extract?.candidates.find((c: any) => c.value === cert)?.source ?? "user";
    try {
      setSession(await api<Session>(`/api/sessions/${session!.id}`, { method: "PATCH", json: {
        grader: grader || undefined, certNumber: cert || undefined, certSource: src, certConfirmed: !!cert,
        gradeLabel: gradeIn && grader ? `${grader} ${gradeIn.replace(/[^\d.]/g, "")}` : undefined,
        itemTitle: titleIn || undefined, askingPriceCents: askIn ? Math.round(Number(askIn) * 100) : undefined,
      } }));
      if (deep) setStep(4);
      else await analyze(); // quick scan goes straight to analysis
    } catch (e) { setErr(e); }
  }
  async function analyze() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/sessions/${session!.id}/analyze`, { method: "POST" });
      router.push(`/sessions/${session!.id}`);
    } catch (e) { setErr(e); setBusy(false); }
  }

  const usage = me.data?.usage;
  const willCharge = session?.creditState !== "consumed";
  const outOfCredits = usage && usage.totalRemaining === 0 && willCharge;
  const steps = deep ? ["Mode", "Front & back", "Label", "Certification", "Security", "Reference", "Analyze"] : ["Mode", "Front & back", "Label", "Certification"];
  const errBody = err instanceof ApiError ? err.body : null;

  return (
    <div className="stack" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="row spread"><h1>Scan slab</h1>{usage && <span className="pill">{usage.totalRemaining} verifications available</span>}</div>
      <div className="steps" aria-label={`Step ${step + 1} of ${steps.length}`}>{steps.map((s, i) => <span key={s} className={i <= step ? "done" : ""} title={s} />)}</div>
      {err && (errBody?.error === "limit_reached" ? <UpgradePrompt reason={errBody.message} /> : <div className="banner bad" role="alert">{err.message}{errBody?.problems && <ul>{errBody.problems.flatMap((p: any) => p.issues.map((i: any) => <li key={p.role + i.issue}><strong>{p.role}:</strong> {i.guidance}</li>))}</ul>}</div>)}

      {step === 0 && (
        <div className="stack">
        <div className="card stack">
          <h2>What are you checking?</h2>
          <div className="row" role="radiogroup" aria-label="Item category">
            {(library.data?.categories ?? []).map((c) => (
              <button key={c.id} role="radio" aria-checked={categoryId === c.id} className={`btn ${categoryId === c.id ? "primary" : ""}`} onClick={() => setCategoryId(c.id)}>
                {c.name}{c.launchStatus !== "supported" && <span className="small" style={{ opacity: 0.8 }}> · {c.launchStatus === "beta" ? "beta" : "limited"}</span>}
              </button>
            ))}
          </div>
          {cat && cat.launchStatus !== "supported" && (
            <div className="banner warn small">Limited checks for {cat.name.toLowerCase()}: our reference library for these graders is still being researched, so most holder checks will be inconclusive. Certificate links, photo-quality checks and reference-image comparison still work.</div>
          )}
          {cat?.subcategories.length ? <p className="small muted">Includes: {cat.subcategories.join(", ")}</p> : null}
          <label className="row small" style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} style={{ width: 20, minHeight: 20 }} />
            <span><strong>Deep check</strong> — also capture holograms, UV, edges and a reference image now. Otherwise we start with a quick scan and ask for extra photos only if something needs a closer look.</span>
          </label>
        </div>
        <div className="grid grid-2">
          <button className="card btn" style={{ display: "block", textAlign: "left", height: "auto" }} onClick={() => start("in_hand").catch(setErr)}>
            <h2>In hand</h2><p className="muted">You have the slab. Use your camera for front, back, label and security captures.</p>
          </button>
          <button className="card btn" style={{ display: "block", textAlign: "left", height: "auto" }} onClick={() => start("online_listing").catch(setErr)}>
            <h2>Online listing</h2><p className="muted">Screen a seller's photos. We can't confirm the seller has the slab or that photos are live.</p>
          </button>
        </div>
        </div>
      )}

      {step === 1 && session && (
        <div className="stack">
          {!inHand && <div className="banner">Online listing mode: upload the seller's photos. Results describe the photos only.</div>}
          <div className="grid grid-2">
            <Capture label="Front" hint={guide?.front ?? "Whole holder, all four edges visible, straight on, no glare."} role="front" highlight={focusRole === "front"} onUpload={upload} images={images} inHand={inHand} />
            <Capture label="Back" hint={guide?.back ?? "Flip it over. Same framing as the front."} role="back" highlight={focusRole === "back"} onUpload={upload} images={images} inHand={inHand} />
          </div>
          <div className="row spread"><span className="small muted">Photos and retakes never use a credit.</span><button className="btn primary" disabled={!images.some((i) => i.role === "front") || !images.some((i) => i.role === "back")} title="Front and back photos are both required" onClick={() => setStep(2)}>Continue</button></div>
        </div>
      )}

      {step === 2 && session && (
        <div className="stack">
          <Capture label="Certification label close-up" hint={guide?.label ?? "Fill the frame with the label. Make sure the number and QR/barcode are sharp."} role="label_closeup" highlight={focusRole === "label_closeup"} onUpload={upload} images={images} inHand={inHand} />
          <div className="row spread"><button className="btn" onClick={() => setStep(1)}>Back</button><div className="row"><button className="btn" disabled={busy} onClick={async () => { await readLabel(); setStep(3); }} title="Read the label from your front photo">Skip close-up</button><button className="btn primary" disabled={busy} onClick={async () => { await readLabel(); setStep(3); }}>{busy ? "Reading label…" : "Read label"}</button></div></div>
        </div>
      )}

      {step === 3 && session && (
        <div className="card stack">
          <h2>Confirm certification</h2>
          {extract?.graders?.[0] && <p className="small muted">Detected: {extract.graders[0].grader} ({extract.graders[0].reasons.join("; ")})</p>}
          {extract && !extract.candidates.length && <p className="small muted">We couldn't read a number automatically — please type it from the label.</p>}
          <div className="grid grid-2">
            <div className="field"><label htmlFor="g">Grading company</label><select id="g" value={grader} onChange={(e) => setGrader(e.target.value)}><option value="">Select…</option>{graderOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
            <div className="field"><label htmlFor="c">Certification number</label><input id="c" inputMode="text" value={cert} onChange={(e) => setCert(e.target.value.toUpperCase())} disabled={!!session.lockedCert} /></div>
          </div>
          {extract?.candidates?.length > 1 && <p className="small">Other readings: {extract.candidates.slice(1).map((c: any) => <button key={c.value} className="pill" onClick={() => setCert(c.value)}>{c.value} ({c.source})</button>)}</p>}
          <p className="small muted">Check each digit against the label — OCR can confuse 0/O, 1/7 and 5/S.</p>
          <div className="grid grid-2">
            <div className="field"><label htmlFor="gl">Grade on label (for market value)</label><input id="gl" placeholder="e.g. 10" value={gradeIn} onChange={(e) => setGradeIn(e.target.value)} /></div>
            {!inHand && <div className="field"><label htmlFor="ap">Asking price (USD, optional)</label><input id="ap" inputMode="decimal" value={askIn} onChange={(e) => setAskIn(e.target.value.replace(/[^\d.]/g, ""))} /></div>}
          </div>
          <div className="field"><label htmlFor="it">Item description (if the grader has no online record)</label><input id="it" placeholder="e.g. 1999 Pokémon Base Set Charizard #4" value={titleIn} onChange={(e) => setTitleIn(e.target.value)} /></div>
          <div className="row spread"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn primary" disabled={!grader || !cert || busy} onClick={confirmCert}>{deep ? "Confirm" : busy ? "Starting…" : "Analyze (quick scan)"}</button></div>
        </div>
      )}

      {step === 4 && session && (
        <div className="stack">
          <div className="banner"><strong>Optional security captures.</strong> They let us check visible holder features. Never bend, open, heat or scrape a slab.{(SECURITY_TIPS[grader] ?? []).map((t) => <div key={t} className="small" style={{ marginTop: 6 }}>• {t}</div>)}</div>
          <div className="grid grid-2">
            <Capture label="Tilt video" hint="A 3–5 second clip slowly tilting the label under one light. We pick distinct, sharp frames." role="tilt_video" onUpload={upload} images={images} inHand={inHand} highlight={focusRole === "tilt_video"} />
            <Capture label="Tilt photos (alternative)" hint="Or 3–5 photos of the label at different angles." role="tilt_frame" multiple onUpload={upload} images={images} inHand={inHand} highlight={focusRole === "tilt_frame"} />
            {grader === "PSA" && <Capture label="Backlit label" hint="Same framing as your label close-up, with a light behind the label." role="backlit" highlight={focusRole === "backlit"} onUpload={upload} images={images} inHand={inHand} />}
            <Capture label="Holder edges & seams" hint="Close-ups of each side of the holder." role="edge" highlight={focusRole === "edge"} multiple onUpload={upload} images={images} inHand={inHand} />
            <Capture label="Blacklight (UV) photo" hint="In a dark room, shine a 365–395 nm blacklight on the label and photograph it straight on. Optional." role="uv" highlight={focusRole === "uv"} onUpload={upload} images={images} inHand={inHand} />
            <Capture label="Security close-up" hint="Hologram or fine print, as close as your camera can focus." role="security_closeup" highlight={focusRole === "security_closeup"} multiple onUpload={upload} images={images} inHand={inHand} />
            {guide?.extras.filter((x) => x.role !== "edge").map((x) => (
              <Capture key={x.role + x.title} label={x.title} hint={x.hint} role={x.role} multiple highlight={focusRole === x.role} onUpload={upload} images={images} inHand={inHand} />
            ))}
          </div>
          <div className="row spread"><button className="btn" onClick={() => setStep(3)}>Back</button><button className="btn primary" onClick={() => setStep(5)}>Continue</button></div>
        </div>
      )}

      {step === 5 && session && (
        <div className="stack">
          <div className="card">
            <h2>Reference image</h2>
            <p className="muted">
              {grader === "PSA" ? "If PSA has images for this cert and our PSA integration is enabled, we retrieve them automatically and label them as official." : `We can't retrieve ${grader || "grader"} images automatically.`}{" "}
              You can also add a reference image you obtained from the grader's cert page. It will be labeled <strong>user-supplied</strong> — never as retrieved from the grader.
            </p>
            {session.officialLookupUrl && <p><a href={session.officialLookupUrl} target="_blank" rel="noopener noreferrer">Open official {grader} cert lookup ↗</a></p>}
            <div className="field"><label htmlFor="att">Where is your reference image from?</label>
              <select id="att" value={att} onChange={(e) => setAtt(e.target.value)}><option value="">Select…</option><option>Saved from the grader's official cert page</option><option>Screenshot of the grader's official cert page</option><option>Other source (marketplace, seller, etc.)</option></select>
            </div>
          </div>
          <div className="grid grid-2">
            <Capture label="Reference — front" hint="Front image from the grader's record." role="reference_front" highlight={focusRole === "reference_front"} onUpload={upload} images={images} attestation={att} inHand={false} />
            <Capture label="Reference — back" hint="Back image, if available." role="reference_back" highlight={focusRole === "reference_back"} onUpload={upload} images={images} attestation={att} inHand={false} />
          </div>
          <div className="row spread"><button className="btn" onClick={() => setStep(4)}>Back</button><button className="btn primary" onClick={() => setStep(6)}>Continue</button></div>
        </div>
      )}

      {step === 6 && session && (
        <div className="card stack">
          <h2>Ready to analyze</h2>
          <ul className="small">{["front", "back", "label_closeup", "tilt_video", "tilt_frame", "backlit", "edge", "reference_front"].map((r) => <li key={r}>{images.some((i) => i.role === r) ? "✓" : "–"} {r.replace("_", " ")}</li>)}</ul>
          <p className="muted small">{willCharge ? "This uses 1 verification credit, charged only when your report is delivered. Failed analyses are not charged." : "Re-analysis of this slab is included — no extra credit."}</p>
          {outOfCredits ? <UpgradePrompt reason="You're out of verifications." /> : <button className="btn primary block" disabled={busy} onClick={analyze}>{busy ? "Starting…" : "Analyze slab"}</button>}
          <Link className="small" href="/dashboard">Save and finish later</Link>
        </div>
      )}
    </div>
  );
}
