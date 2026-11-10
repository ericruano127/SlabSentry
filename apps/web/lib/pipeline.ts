import { createHash } from "node:crypto";
import {
  buildReport, detectGrader, extractCertCandidates, hasFeature, runEngine, type CompiledLibrary,
  type ComparisonResult, type EngineInput, type GraderId, type HolderInspectionResult, type OfficialCertRecord, type QualityReport,
} from "@slabguard/core";
import { one, q } from "./db";
import { env } from "./env";
import { consumeCredit, entitlementsFor, releaseCredit } from "./credits";
import { recordCost } from "./costs";
import { lookupCert, type LookupResult } from "./graders/lookup";
import { webDetection } from "./reverse-image";
import { distinctImages } from "@slabguard/core";
import { activeImages, storeVideoFrames } from "./sessions";
import { loadLibrary } from "./library";
import { sanitize } from "./metadata";
import { storage } from "./storage";
import { vision } from "./vision";

const LOOKUP_TTL_H = 24;

async function cachedLookup(grader: GraderId, cert: string, lib: CompiledLibrary): Promise<LookupResult> {
  const c = await one(`select data from cert_lookups where grader=$1 and cert_number=$2 and fetched_at > now() - make_interval(hours => $3)`, [grader, cert, LOOKUP_TTL_H]);
  if (c) return c.data;
  const r = await lookupCert(grader, cert, lib);
  if (r.record.found !== null && !r.providerError) {
    await q(`insert into cert_lookups (grader,cert_number,data) values ($1,$2,$3) on conflict (grader,cert_number) do update set data=excluded.data, fetched_at=now()`, [grader, cert, JSON.stringify(r)]);
  }
  return r;
}

const load = (img: any) => storage.get(img.storage_key);

async function storeDerived(session: any, parent: any, role: string, b64: string, tool: string) {
  const data = Buffer.from(b64, "base64");
  const sha = createHash("sha256").update(data).digest("hex");
  const key = `${session.user_id}/${session.id}/derived/${role}-${sha.slice(0, 16)}.png`;
  await storage.put(key, data, "image/png");
  const r = await one(
    `insert into submitted_images (session_id,user_id,role,is_original,derived_from,storage_key,mime,bytes,sha256,provenance) values ($1,$2,$3,false,$4,$5,'image/png',$6,$7,$8) returning id`,
    [session.id, session.user_id, role, parent.id, key, data.length, sha, JSON.stringify({ source: "computed", tool, retrievedAt: new Date().toISOString() })],
  );
  return r.id as string;
}

async function fetchOfficialImage(session: any, side: "front" | "back", url: string, cert: string) {
  const existing = await one(`select i.* from official_reference_images o join submitted_images i on i.id=o.image_id where o.session_id=$1 and o.side=$2 and o.source='official_api' and o.cert_number=$3`, [session.id, side, cert]);
  if (existing) return existing;
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const rawData = Buffer.from(await r.arrayBuffer());
  if (rawData.length > 20 * 1024 * 1024) return null;
  const mime = r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  let data: Buffer;
  try {
    data = sanitize(rawData, ["image/png", "image/webp"].includes(mime) ? mime : "image/jpeg").data; // grader images are stripped too
  } catch {
    return null;
  }
  const sha = createHash("sha256").update(data).digest("hex");
  const key = `${session.user_id}/${session.id}/official/${side}-${sha.slice(0, 16)}.jpg`;
  await storage.put(key, data, r.headers.get("content-type") ?? "image/jpeg");
  const img = await one(
    `insert into submitted_images (session_id,user_id,role,storage_key,mime,bytes,sha256,provenance) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [session.id, session.user_id, `reference_${side}`, key, r.headers.get("content-type") ?? "image/jpeg", data.length, sha, JSON.stringify({ source: "official_api", url, retrievedAt: new Date().toISOString(), tool: "psa-public-api" })],
  );
  await q(`insert into official_reference_images (session_id,grader,cert_number,side,source,availability,source_url,image_id) values ($1,$2,$3,$4,'official_api','available',$5,$6)`, [session.id, session.grader, cert, side, url, img.id]);
  return img;
}

/** Full analysis for one session. Throws on failures that prevent a meaningful report (credit released by caller). */
export async function runAnalysis(sessionId: string) {
  const session = await one(`select * from verification_sessions where id=$1`, [sessionId]);
  if (!session) return;
  const run = session.analysis_count + 1;
  const t0 = Date.now();
  await q(`update verification_sessions set status='processing', error=null, updated_at=now() where id=$1`, [sessionId]);
  const { ent } = await entitlementsFor(session.user_id);
  // Published reference library (integrity-checked) + this session's category.
  const lib = await loadLibrary();
  const category = lib.category(session.category);
  const geometry = { itemAspect: category.geometry.itemAspect, holderAspect: category.geometry.holderAspect };
  const images = await activeImages(sessionId);
  const byRole = (r: string) => images.filter((i) => i.role === r);
  const front = byRole("front")[0];
  if (!front) throw new Error("front image missing");

  // Re-check quality for images uploaded while the vision service was unavailable.
  for (const img of images.filter((i) => !i.quality)) {
    if (img.role === "tilt_video") {
      const r = await vision.frames(await load(img));
      await storeVideoFrames(session.user_id, sessionId, img.id, r.frames);
      img.quality = { ok: r.status === "ok", score: 1, issues: [], metrics: { durationSec: r.durationSec, distinctFrames: r.distinctFrames, sampled: r.sampled } };
    } else img.quality = await vision.quality(await load(img), img.role, geometry);
    await q(`update submitted_images set quality=$2 where id=$1`, [img.id, JSON.stringify(img.quality)]);
  }

  // ---- 1. Holder inspection (cached by input hashes so retakes rerun only what changed)
  const label = byRole("label_closeup")[0];
  // Tilt evidence: photo frames + frames extracted from the latest tilt video; near-duplicates removed
  // so a static sequence can't pose as several independent observations.
  const video = byRole("tilt_video")[0];
  const videoFrames = video ? await q(`select * from submitted_images where derived_from=$1 and role='tilt_frame' order by created_at`, [video.id]) : [];
  const tilt = [...distinctImages(byRole("tilt_frame")).kept, ...videoFrames].slice(0, 12);
  const backlit = byRole("backlit")[0];
  const holderKey = [front, label, backlit, ...tilt].filter(Boolean).map((i) => i.sha256).join(":");
  let holder: HolderInspectionResult | null = (await one(`select data from verification_evidence where session_id=$1 and kind='holder' and data->>'inputKey'=$2 order by created_at desc limit 1`, [sessionId, holderKey]))?.data ?? null;
  if (!holder) {
    holder = await vision.holder({ front: await load(front), label: label && (await load(label)), tilt: await Promise.all(tilt.map(load)), normal: backlit && label ? await load(label) : undefined, backlit: backlit && label ? await load(backlit) : undefined }, geometry);
    (holder as any).inputKey = holderKey;
    await recordCost(sessionId, session.user_id, "vision_cpu_second", ((holder as any).elapsedMs ?? 0) / 1000);
  }
  await q(`insert into verification_evidence (session_id,analysis_run,kind,data,provenance) values ($1,$2,'holder',$3,$4)`, [sessionId, run, JSON.stringify(holder), JSON.stringify({ source: "computed", tool: holder.toolVersion, retrievedAt: new Date().toISOString() })]);

  // ---- 2. Grader + cert (user-confirmed values take precedence)
  let grader: GraderId | null = session.grader;
  let cert: string | null = session.cert_number;
  let certSource = session.cert_source as EngineInput["certSource"];
  if (!grader) grader = detectGrader({ codes: holder.codes.map((c) => c.data), ocrText: holder.ocrText }, lib, category.id)[0]?.grader ?? null;
  if (!cert) {
    const cand = extractCertCandidates(grader, { codes: holder.codes.map((c) => c.data), ocrText: holder.ocrText }, lib, category.id)[0];
    if (cand) (cert = cand.value), (certSource = cand.source);
  }
  if (session.locked_cert && cert !== session.locked_cert) throw Object.assign(new Error("This session is bound to a different slab. Start a new session for another card."), { userFacing: true, noRetry: true });

  // ---- 3. Official record
  let lookup: LookupResult | null = null;
  if (grader && cert) {
    lookup = await cachedLookup(grader, cert, lib);
    await q(`insert into verification_evidence (session_id,analysis_run,kind,data,provenance) values ($1,$2,'official_record',$3,$4)`, [sessionId, run, JSON.stringify(lookup.record), JSON.stringify(lookup.record.provenance)]);
    if (grader === "PSA" && env.psaToken) await recordCost(sessionId, session.user_id, "psa_api_call", 1);
  }

  // ---- 4. Reference images: official (if retrieved) else user-supplied
  const refs: Record<"front" | "back", { img: any; source: "official_api" | "user_supplied_reference" } | null> = { front: null, back: null };
  for (const side of ["front", "back"] as const) {
    const url = lookup?.images.find((i) => i.side === side)?.url;
    const official = url && cert ? await fetchOfficialImage(session, side, url, cert).catch(() => null) : null;
    if (official) refs[side] = { img: official, source: "official_api" };
    else {
      const user = images.find((i) => i.role === `reference_${side}` && i.provenance?.source === "user_supplied_reference");
      if (user) refs[side] = { img: user, source: "user_supplied_reference" };
    }
  }

  // ---- 5. Reference comparison (cached per image pair)
  const comparisons: EngineInput["comparisons"] = [];
  for (const side of ["front", "back"] as const) {
    const up = byRole(side)[0];
    const ref = refs[side];
    if (!up || !ref) continue;
    const prev = await one(`select result from image_comparisons where session_id=$1 and upload_image_id=$2 and reference_image_id=$3 order by created_at desc limit 1`, [sessionId, up.id, ref.img.id]);
    let result: ComparisonResult;
    if (prev) result = prev.result;
    else {
      const raw: any = await vision.compare(await load(up), await load(ref.img), side === "front" ? holder.ocrText : undefined, geometry);
      await recordCost(sessionId, session.user_id, "vision_cpu_second", (raw.elapsedMs ?? 0) / 1000);
      const ov: Record<string, string> = {};
      for (const [k, v] of Object.entries<string | undefined>(raw.overlays ?? {})) if (v) ov[k] = await storeDerived(session, up, `overlay_${side}_${k}`, v, raw.toolVersion);
      result = { ...raw, overlays: ov };
    }
    await q(`insert into image_comparisons (session_id,analysis_run,side,upload_image_id,reference_image_id,result,tool_version) values ($1,$2,$3,$4,$5,$6,$7)`, [sessionId, run, side, up.id, ref.img.id, JSON.stringify(result), result.toolVersion]);
    comparisons.push({ side, referenceSource: ref.source, result });
  }

  // ---- 5b. Holder edge / seam close-ups (cached per image)
  const edgeReviews: EngineInput["edgeReviews"] = [];
  for (const img of byRole("edge").slice(0, 6)) {
    const prev = await one(`select data from verification_evidence where session_id=$1 and kind='edge_review' and data->>'imageId'=$2 order by created_at desc limit 1`, [sessionId, img.id]);
    const r = prev?.data ?? { ...(await vision.edge(await load(img))), imageId: img.id };
    if (!prev) await q(`insert into verification_evidence (session_id,analysis_run,kind,data,provenance) values ($1,$2,'edge_review',$3,$4)`, [sessionId, run, JSON.stringify(r), JSON.stringify({ source: "computed", tool: "vision/seam", retrievedAt: new Date().toISOString() })]);
    edgeReviews.push(r);
  }
  const tiltVideo: EngineInput["tiltVideo"] = video?.quality?.metrics
    ? { videoId: video.id, durationSec: video.quality.metrics.durationSec, sampled: video.quality.metrics.sampled, distinctFrames: video.quality.metrics.distinctFrames, status: video.quality.ok ? "ok" : "too_few_distinct_frames" }
    : undefined;

  // ---- 6. Reverse image search (entitlement + configuration gated)
  let reverseImage: EngineInput["reverseImage"] = { status: hasFeature(ent, "reverse_image") ? "not_configured" : "not_entitled", samePhotoUrls: [], similarUrls: [] };
  if (hasFeature(ent, "reverse_image") && env.googleVisionKey) {
    const prev = await one(`select data from verification_evidence where session_id=$1 and kind='reverse_image' and data->>'sha'=$2 limit 1`, [sessionId, front.sha256]);
    const wd = prev?.data ?? { ...(await webDetection(await load(front)).catch(() => null)), sha: front.sha256 };
    if (wd?.samePhotoUrls) {
      reverseImage = { status: "done", samePhotoUrls: wd.samePhotoUrls, similarUrls: wd.similarUrls };
      if (!prev) {
        await recordCost(sessionId, session.user_id, "google_vision_web_detection", 1);
        await q(`insert into verification_evidence (session_id,analysis_run,kind,data,provenance) values ($1,$2,'reverse_image',$3,$4)`, [sessionId, run, JSON.stringify(wd), JSON.stringify({ source: "third_party_search", tool: "google-vision-web-detection", retrievedAt: new Date().toISOString() })]);
      }
    }
  }

  // ---- 7. Rules engine + report
  const input: EngineInput = {
    library: lib, category: category.id,
    mode: session.mode, grader, certNumber: cert, certSource, certUserConfirmed: session.cert_confirmed,
    record: lookup?.record ?? null, labelOcrText: holder.ocrText,
    images: images.filter((i) => !i.role.startsWith("reference_") && i.role !== "tilt_video").map((i) => ({ id: i.id, role: i.role, quality: i.quality as QualityReport })),
    comparisons, holder, reverseImage, edgeReviews, tiltVideo,
  };
  const out = runEngine(input);
  const report = buildReport(sessionId, input, out);
  (report as any).reverseImageStatus = reverseImage.status;
  (report as any).planAtGeneration = ent.planId;

  await q(`insert into verification_reports (session_id,analysis_run,report,rules_version) values ($1,$2,$3,$4)`, [sessionId, run, JSON.stringify(report), out.rulesVersion]);
  for (const f of out.findings) await q(`insert into risk_findings (session_id,analysis_run,severity,pattern,data) values ($1,$2,$3,$4,$5)`, [sessionId, run, f.severity, f.pattern, JSON.stringify(f)]);
  const title = (lookup?.record as OfficialCertRecord | undefined)?.description || (grader && cert ? `${grader} ${cert}` : "Untitled slab");
  await q(
    `update verification_sessions set status='completed', analysis_count=$2, overall_assessment=$3, grader=coalesce(grader,$4), cert_number=coalesce(cert_number,$5), cert_source=coalesce(cert_source,$6),
       locked_cert=coalesce(locked_cert,$5), title=$7, completed_at=now(), updated_at=now() where id=$1`,
    [sessionId, run, out.assessment, grader, cert, certSource, title],
  );

  // ---- 8. Billing: charge only for a substantive report.
  const providerBlocked = !!lookup?.providerError && comparisons.length === 0;
  if (providerBlocked) await releaseCredit(session.user_id, sessionId, "provider_unavailable");
  else await consumeCredit(session.user_id, sessionId);
  await recordCost(sessionId, session.user_id, "storage_gb_month", images.reduce((a, i) => a + i.bytes, 0) / 1e9);
  return { report, ms: Date.now() - t0 };
}
