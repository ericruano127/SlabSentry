import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { ASSESSMENT_LABELS, type VerificationReport } from "@slabguard/core";

const STATUS_LABEL: Record<string, string> = {
  consistent: "Consistent", potential_discrepancy: "Potential discrepancy", inconclusive: "Inconclusive",
  not_visible: "Not visible", not_supported_by_device: "Not supported by device", not_applicable: "Not applicable",
};

/** Render one or more reports (batch export) into a PDF. Personal data is not included. */
export async function renderReportsPdf(items: { report: VerificationReport; overlayPng?: Buffer | null }[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const { report: r, overlayPng } of items) {
    let page = doc.addPage([612, 792]);
    let y = 750;
    const line = (t: string, o: { size?: number; f?: PDFFont; color?: [number, number, number]; indent?: number } = {}) => {
      const size = o.size ?? 10;
      for (const chunk of wrap(t, o.f ?? font, size, 532 - (o.indent ?? 0))) {
        if (y < 50) ((page = doc.addPage([612, 792])), (y = 750));
        page.drawText(chunk, { x: 40 + (o.indent ?? 0), y, size, font: o.f ?? font, color: rgb(...(o.color ?? [0.1, 0.1, 0.12])) });
        y -= size + 4;
      }
    };
    line("SlabGuard Verification Report", { size: 18, f: bold });
    line(`Generated ${new Date(r.generatedAt).toUTCString()} · ${r.mode === "in_hand" ? "In-hand" : "Online listing"} mode`, { size: 9, color: [0.4, 0.4, 0.45] });
    y -= 6;
    const tone = ASSESSMENT_LABELS[r.engine.assessment].tone;
    line(`Overall: ${r.assessmentLabel}`, { size: 14, f: bold, color: tone === "bad" ? [0.7, 0.1, 0.1] : tone === "warn" ? [0.65, 0.4, 0] : tone === "ok" ? [0.1, 0.5, 0.25] : [0.3, 0.3, 0.3] });
    line(`Evidence quality: ${r.engine.evidenceQuality.level}`, { f: bold });
    y -= 4;
    line("Card identification", { size: 12, f: bold });
    const id = r.identification;
    line(`${id.graderName ?? "Grader unknown"} · Cert ${id.certNumber ?? "—"}`);
    if (id.record) line([id.record.year, id.record.brand, id.record.subject, id.record.cardNumber && `#${id.record.cardNumber}`, id.record.variety, id.record.grade && `Grade ${id.record.grade}`].filter(Boolean).join(" · "));
    line(`Official record: ${r.official.recordStatus.replace("_", " ")} · Reference images: ${r.official.imageAvailability.replace("_", " ")}`);
    if (r.official.lookupUrl) line(`Verify: ${r.official.lookupUrl}`, { size: 9, color: [0.1, 0.3, 0.7] });
    if (overlayPng) {
      const im = await doc.embedPng(overlayPng);
      const w = 532, h = (im.height / im.width) * w;
      if (y - h < 50) ((page = doc.addPage([612, 792])), (y = 750));
      page.drawImage(im, { x: 40, y: y - h, width: w, height: h });
      y -= h + 10;
    }
    if (r.engine.findings.length) {
      line("Risk findings", { size: 12, f: bold });
      for (const f of r.engine.findings) {
        line(`[${f.severity.toUpperCase()}] ${f.summary}`, { f: bold });
        line(f.explanation, { indent: 12 });
        if (f.legitimateExplanations.length) line(`Possible legitimate explanations: ${f.legitimateExplanations.join("; ")}`, { indent: 12, size: 9, color: [0.4, 0.4, 0.45] });
      }
    }
    line("Observations", { size: 12, f: bold });
    for (const o of r.engine.observations) line(`${STATUS_LABEL[o.status]} — ${o.title} (${o.basis}): ${o.detail}`, { size: 9 });
    line("Recommended next actions", { size: 12, f: bold });
    for (const a of r.engine.nextActions) line(`• ${a}`);
    y -= 6;
    line(r.disclaimer, { size: 8, color: [0.4, 0.4, 0.45] });
    line(`Rules ${r.engine.rulesVersion}`, { size: 8, color: [0.4, 0.4, 0.45] });
  }
  return doc.save();
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const clean = text.replace(/[^\x20-\x7E·•—]/g, "").replace(/[·•—]/g, (c) => ({ "·": "-", "•": "*", "—": "-" })[c]!);
  const out: string[] = [];
  let cur = "";
  for (const w of clean.split(" ")) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && cur) (out.push(cur), (cur = w));
    else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
