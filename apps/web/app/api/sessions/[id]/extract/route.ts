import { detectGrader, extractCertCandidates } from "@slabguard/core";
import { loadLibrary } from "@/lib/library";
import { requireUser } from "@/lib/auth";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { activeImages, getOwnedSession } from "@/lib/sessions";
import { storage } from "@/lib/storage";
import { vision } from "@/lib/vision";

/** Read grader + cert number from the label (QR/barcode first, OCR second). The user must confirm. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  await rateLimit(`extract:${u.id}`, 60, 3600);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const imgs = await activeImages(s.id);
  const src = imgs.find((i) => i.role === "label_closeup") ?? imgs.find((i) => i.role === "front");
  if (!src) throw new HttpError(400, "no_image", "Add a label or front photo first.");
  const r = await vision.extract(await storage.get(src.storage_key)).catch(() => {
    throw new HttpError(503, "vision_unavailable", "Label reading is temporarily unavailable. You can type the certification number.");
  });
  const codes = r.codes.map((c) => c.data);
  const ocrText = r.ocr.map((o) => o.text);
  const lib = await loadLibrary();
  const graders = detectGrader({ codes, ocrText }, lib, s.category);
  const candidates = extractCertCandidates(graders[0]?.grader ?? null, { codes, ocrText }, lib, s.category);
  return json({ graders, candidates, codes, ocrText });
});
