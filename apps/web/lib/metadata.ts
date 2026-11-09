/**
 * Lossless metadata sanitizer, applied to every upload BEFORE storage, analysis or training use.
 *
 * - Pixel/entropy data is never re-encoded: only metadata containers are removed, so images stay
 *   bit-identical where it matters for forensic review.
 * - Removes EXIF (incl. GPS, camera serials, thumbnails), XMP, IPTC/Photoshop blocks, comments,
 *   PNG text/eXIf/tIME chunks, WebP EXIF/XMP chunks, MP4/MOV udta/meta/uuid boxes (location,
 *   device), WebM Tags/Attachments, and any bytes appended after the image end (polyglots,
 *   hidden secondary images).
 * - Keeps only what decoding/display needs: JFIF, ICC colour profile, Adobe colour transform,
 *   and a minimal EXIF block holding just the Orientation value (so photos aren't rotated).
 * - Returns non-identifying signals read before removal (e.g. "an editing app was named") for
 *   the image-manipulation checks. GPS values, camera serials and owner names are never kept.
 */

export interface MetadataSignals {
  format: "jpeg" | "png" | "webp" | "mp4" | "webm";
  hadExif: boolean;
  hadGps: boolean;
  hadXmp: boolean;
  hadCameraMakeModel: boolean;
  dateTimeOriginalPresent: boolean;
  software: string | null; // creator/editor software name (truncated); no device serials
  editorDetected: boolean;
  orientation: number;
  removed: string[]; // container names removed
  trailingBytesRemoved: number;
  width?: number;
  height?: number;
}

export class MetadataError extends Error {
  constructor(public code: "truncated" | "malformed" | "too_many_pixels", message: string) {
    super(message);
  }
}

export const MAX_PIXELS = Number(process.env.MAX_IMAGE_PIXELS ?? 50_000_000);
export const MAX_SIDE = Number(process.env.MAX_IMAGE_SIDE ?? 12_000);
const EDITOR = /photoshop|lightroom|gimp|snapseed|picsart|facetune|affinity|pixelmator|canva|photopea|paint\.net|luminar|meitu|airbrush|remini|faceapp/i;

const blank = (format: MetadataSignals["format"]): MetadataSignals => ({
  format, hadExif: false, hadGps: false, hadXmp: false, hadCameraMakeModel: false, dateTimeOriginalPresent: false,
  software: null, editorDetected: false, orientation: 1, removed: [], trailingBytesRemoved: 0,
});

export function sanitize(buf: Buffer, mime: string): { data: Buffer; signals: MetadataSignals } {
  switch (mime) {
    case "image/jpeg": return sanitizeJpeg(buf);
    case "image/png": return sanitizePng(buf);
    case "image/webp": return sanitizeWebp(buf);
    case "video/mp4":
    case "video/quicktime": return sanitizeMp4(buf);
    case "video/webm": return sanitizeWebm(buf);
    default: throw new MetadataError("malformed", `unsupported type ${mime}`);
  }
}

function checkDims(s: MetadataSignals) {
  if (!s.width || !s.height) throw new MetadataError("malformed", "image dimensions not found");
  if (s.width > MAX_SIDE || s.height > MAX_SIDE || s.width * s.height > MAX_PIXELS)
    throw new MetadataError("too_many_pixels", `image is ${s.width}×${s.height}; maximum is ${MAX_PIXELS / 1e6} megapixels`);
}

// ---------------------------------------------------------------- JPEG
function sanitizeJpeg(b: Buffer) {
  const s = blank("jpeg");
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new MetadataError("malformed", "not a JPEG");
  const out: Buffer[] = [b.subarray(0, 2)];
  let p = 2;
  let insertAt = 1; // index in `out` after which a minimal EXIF goes (after SOI / APP0)
  let ended = false;
  const segment = (marker: number, start: number, len: number) => {
    const seg = b.subarray(start, start + 2 + len);
    const payload = b.subarray(start + 4, start + 2 + len);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && payload.length >= 5) {
      s.height = payload.readUInt16BE(1);
      s.width = payload.readUInt16BE(3);
    }
    if (marker === 0xe0) { out.push(seg); insertAt = out.length; return; } // JFIF/JFXX
    if (marker === 0xe1) {
      if (payload.subarray(0, 6).toString("latin1") === "Exif\0\0") readExif(payload.subarray(6), s);
      else if (payload.subarray(0, 29).toString("latin1").startsWith("http://ns.adobe.com/xap/1.0/")) readXmp(payload.toString("utf8"), s);
      s.removed.push(payload.subarray(0, 4).toString("latin1") === "Exif" ? "EXIF" : "XMP");
      return;
    }
    if (marker === 0xe2 && payload.subarray(0, 12).toString("latin1") === "ICC_PROFILE\0") { out.push(seg); return; }
    if (marker === 0xee) { out.push(seg); return; } // Adobe colour transform
    if ((marker >= 0xe2 && marker <= 0xef) || marker === 0xfe) {
      s.removed.push(marker === 0xfe ? "COM" : marker === 0xed ? "IPTC/Photoshop" : `APP${marker - 0xe0}`);
      return;
    }
    out.push(seg);
  };
  while (p < b.length && !ended) {
    if (b[p] !== 0xff) throw new MetadataError("malformed", "invalid JPEG marker");
    while (b[p] === 0xff && b[p + 1] === 0xff) p++; // fill bytes
    const marker = b[p + 1];
    if (marker === 0xd9) { out.push(b.subarray(p, p + 2)); p += 2; ended = true; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(b.subarray(p, p + 2)); p += 2; continue; }
    if (p + 4 > b.length) throw new MetadataError("truncated", "JPEG is truncated");
    const len = b.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > b.length) throw new MetadataError("truncated", "JPEG is truncated");
    segment(marker, p, len);
    p += 2 + len;
    if (marker === 0xda) {
      // entropy-coded data: copy until the next real marker (FF00 = stuffed byte, FFD0-D7 = restart)
      const start = p;
      while (p < b.length - 1) {
        if (b[p] === 0xff && b[p + 1] !== 0x00 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7) && b[p + 1] !== 0xff) break;
        p++;
      }
      if (p >= b.length - 1) throw new MetadataError("truncated", "JPEG is truncated (no end marker)");
      out.push(b.subarray(start, p));
    }
  }
  if (!ended) throw new MetadataError("truncated", "JPEG is truncated (no end marker)");
  s.trailingBytesRemoved = b.length - p;
  if (s.trailingBytesRemoved) s.removed.push("trailing data");
  checkDims(s);
  if (s.orientation !== 1) out.splice(insertAt, 0, minimalOrientationExif(s.orientation));
  return { data: Buffer.concat(out), signals: s };
}

function minimalOrientationExif(o: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(o, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Minimal TIFF/EXIF reader: only the non-identifying signals we keep. */
function readExif(t: Buffer, s: MetadataSignals) {
  s.hadExif = true;
  if (t.length < 8) return;
  const le = t.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t.readUInt16LE(o) : t.readUInt16BE(o)) : 0);
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? t.readUInt32LE(o) : t.readUInt32BE(o)) : 0);
  const ascii = (count: number, valOff: number) => {
    const off = count <= 4 ? valOff : u32(valOff);
    return off + count <= t.length ? t.toString("latin1", off, off + count).replace(/\0.*$/s, "").trim() : "";
  };
  const walk = (ifd: number, depth: number) => {
    if (ifd <= 0 || ifd + 2 > t.length || depth > 3) return;
    const n = u16(ifd);
    for (let i = 0; i < n && i < 512; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.length) return;
      const tag = u16(e), count = u32(e + 4);
      switch (tag) {
        case 0x0112: s.orientation = Math.min(8, Math.max(1, u16(e + 8))) || 1; break;
        case 0x010f: case 0x0110: if (ascii(count, e + 8)) s.hadCameraMakeModel = true; break;
        case 0x0131: s.software = ascii(count, e + 8).slice(0, 60) || s.software; break;
        case 0x9003: s.dateTimeOriginalPresent = true; break;
        case 0x8825: s.hadGps = true; break;
        case 0x8769: walk(u32(e + 8), depth + 1); break;
      }
    }
  };
  walk(u32(4), 0);
  if (s.software && EDITOR.test(s.software)) s.editorDetected = true;
}

function readXmp(x: string, s: MetadataSignals) {
  s.hadXmp = true;
  const tool = x.match(/CreatorTool(?:="|>)([^"<]{1,80})/)?.[1];
  if (tool) s.software = s.software ?? tool.slice(0, 60);
  if (EDITOR.test(x.slice(0, 20000))) s.editorDetected = true;
  if (/exif:GPS(Latitude|Longitude)/.test(x)) s.hadGps = true;
}

// ---------------------------------------------------------------- PNG
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", "acTL", "fcTL", "fdAT"]);

function sanitizePng(b: Buffer) {
  const s = blank("png");
  if (!b.subarray(0, 8).equals(PNG_SIG)) throw new MetadataError("malformed", "not a PNG");
  const out: Buffer[] = [PNG_SIG];
  let p = 8, ended = false;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    const end = p + 12 + len;
    if (end > b.length) throw new MetadataError("truncated", "PNG is truncated");
    if (type === "IHDR") { s.width = b.readUInt32BE(p + 8); s.height = b.readUInt32BE(p + 12); }
    if (PNG_KEEP.has(type)) out.push(b.subarray(p, end));
    else {
      if (type === "eXIf") readExif(b.subarray(p + 8, p + 8 + len), s);
      if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
        const txt = b.toString("latin1", p + 8, p + 8 + Math.min(len, 4000));
        if (/^XML:com\.adobe\.xmp/.test(txt)) readXmp(txt, s);
        const sw = txt.match(/^Software\0(.{1,80})/s)?.[1];
        if (sw) { s.software = sw.slice(0, 60); if (EDITOR.test(sw)) s.editorDetected = true; }
      }
      s.removed.push(type);
    }
    p = end;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended) throw new MetadataError("truncated", "PNG is truncated (no IEND)");
  s.trailingBytesRemoved = b.length - p;
  if (s.trailingBytesRemoved) s.removed.push("trailing data");
  checkDims(s);
  return { data: Buffer.concat(out), signals: s };
}

// ---------------------------------------------------------------- WebP
function sanitizeWebp(b: Buffer) {
  const s = blank("webp");
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") throw new MetadataError("malformed", "not a WebP");
  const riffEnd = 8 + b.readUInt32LE(4);
  if (riffEnd > b.length) throw new MetadataError("truncated", "WebP is truncated");
  const chunks: Buffer[] = [];
  let p = 12;
  let vp8x: Buffer | null = null;
  while (p + 8 <= riffEnd) {
    const id = b.toString("latin1", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const end = p + 8 + size + (size & 1);
    if (p + 8 + size > riffEnd) throw new MetadataError("truncated", "WebP is truncated");
    const data = b.subarray(p + 8, p + 8 + size);
    if (id === "EXIF") { readExif(data.subarray(0, 6).toString("latin1") === "Exif\0\0" ? data.subarray(6) : data, s); s.removed.push("EXIF"); }
    else if (id === "XMP ") { readXmp(data.toString("utf8"), s); s.removed.push("XMP"); }
    else if (["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"].includes(id)) {
      const c = Buffer.from(b.subarray(p, Math.min(end, riffEnd)));
      if (id === "VP8X") { vp8x = c; s.width = 1 + c.readUIntLE(12, 3); s.height = 1 + c.readUIntLE(15, 3); }
      if (id === "VP8 " && !s.width && data.length >= 10) { s.width = data.readUInt16LE(6) & 0x3fff; s.height = data.readUInt16LE(8) & 0x3fff; }
      if (id === "VP8L" && !s.width && data.length >= 5) { const v = data.readUInt32LE(1); s.width = 1 + (v & 0x3fff); s.height = 1 + ((v >> 14) & 0x3fff); }
      chunks.push(c);
    } else s.removed.push(id.trim());
    p = end;
  }
  if (vp8x) (vp8x as Buffer)[8] &= ~(0x08 | 0x04); // clear EXIF + XMP flags
  s.orientation = 1; // WebP orientation metadata is not honoured consistently by decoders; not retained
  s.trailingBytesRemoved = b.length - riffEnd;
  checkDims(s);
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return { data: Buffer.concat([head, body]), signals: s };
}

// ---------------------------------------------------------------- MP4 / MOV
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf"]);
const MP4_STRIP = new Set(["udta", "meta", "uuid"]);

/** Neutralises metadata boxes in place: type → 'free', payload zeroed. Sizes/offsets are unchanged. */
function sanitizeMp4(input: Buffer) {
  const s = blank("mp4");
  const b = Buffer.from(input);
  const walk = (start: number, end: number, depth: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = b.readUInt32BE(p);
      const type = b.toString("latin1", p + 4, p + 8);
      let header = 8;
      if (size === 1) { if (p + 16 > end) break; size = Number(b.readBigUInt64BE(p + 8)); header = 16; }
      else if (size === 0) size = end - p;
      if (size < header || p + size > end) throw new MetadataError("truncated", "video container is truncated");
      if (MP4_STRIP.has(type) && (depth > 0 || type === "uuid" || type === "meta" || type === "udta")) {
        const payload = b.subarray(p + header, p + size);
        const txt = payload.toString("latin1");
        if (txt.includes("©xyz") || txt.includes("ISO6709") || txt.includes("location")) s.hadGps = true;
        if (txt.includes("©mak") || txt.includes("©mod") || txt.includes("com.apple.quicktime.make")) s.hadCameraMakeModel = true;
        const sw = txt.match(/©swr.{0,12}?([\x20-\x7e]{3,60})/)?.[1] ?? txt.match(/com\.apple\.quicktime\.software[^\x20-\x7e]*([\x20-\x7e]{2,40})/)?.[1];
        if (sw) { s.software = sw.slice(0, 60); if (EDITOR.test(sw)) s.editorDetected = true; }
        b.write("free", p + 4, "latin1");
        payload.fill(0);
        s.removed.push(type);
      } else if (MP4_CONTAINERS.has(type)) walk(p + header, p + size, depth + 1);
      p += size;
    }
  };
  if (b.toString("latin1", 4, 8) !== "ftyp") throw new MetadataError("malformed", "not an MP4/MOV file");
  walk(0, b.length, 0);
  return { data: b, signals: s };
}

// ---------------------------------------------------------------- WebM (Matroska)
function vint(b: Buffer, p: number, keepMarker: boolean): { value: number; len: number } {
  const first = b[p];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) throw new MetadataError("malformed", "invalid WebM element");
  let value = keepMarker ? first : first & (0xff >> len);
  for (let i = 1; i < len; i++) value = value * 256 + b[p + i];
  return { value, len };
}

/** Best-effort: Tags and Attachments elements are overwritten with same-length Void elements. */
function sanitizeWebm(input: Buffer) {
  const s = blank("webm");
  const b = Buffer.from(input);
  if (b.readUInt32BE(0) !== 0x1a45dfa3) throw new MetadataError("malformed", "not a WebM file");
  let p = 0;
  while (p < b.length) {
    const id = vint(b, p, true);
    const size = vint(b, p + id.len, false);
    const dataStart = p + id.len + size.len;
    const unknown = size.value === Math.pow(2, 7 * size.len) - 1;
    if (id.value === 0x18538067) {
      // Segment: scan children until a child of unknown size (live-written clusters)
      let c = dataStart;
      const segEnd = unknown ? b.length : Math.min(b.length, dataStart + size.value);
      while (c < segEnd) {
        const cid = vint(b, c, true);
        const csz = vint(b, c + cid.len, false);
        if (csz.value === Math.pow(2, 7 * csz.len) - 1) break;
        const total = cid.len + csz.len + csz.value;
        if (c + total > b.length) break;
        if (cid.value === 0x1254c367 || cid.value === 0x1941a469) {
          voidElement(b, c, total);
          s.removed.push(cid.value === 0x1254c367 ? "Tags" : "Attachments");
        }
        c += total;
      }
      break;
    }
    if (unknown) break;
    p = dataStart + size.value;
  }
  return { data: b, signals: s };
}

function voidElement(b: Buffer, start: number, total: number) {
  const n = total >= 9 ? 8 : 1;
  const dataLen = total - 1 - n;
  b[start] = 0xec;
  if (n === 8) {
    b[start + 1] = 0x01;
    b.writeUIntBE(Math.floor(dataLen / 2 ** 24), start + 2, 3);
    b.writeUIntBE(dataLen % 2 ** 24, start + 5, 3);
    b.fill(0, start + 9, start + total);
  } else {
    b[start + 1] = 0x80 | dataLen;
    b.fill(0, start + 2, start + total);
  }
}
