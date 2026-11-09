/**
 * Metadata sanitizer: identifying metadata is removed, pixels are untouched, orientation survives,
 * hidden trailing data is cut, oversized/truncated files are rejected.
 * Uses the vision service's Python/OpenCV to create real media and to compare decoded pixels.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MetadataError, sanitize } from "../lib/metadata";

const PY = path.resolve(process.cwd(), "../../services/vision/.venv/bin/python");
const dir = mkdtempSync(path.join(tmpdir(), "meta-"));
const py = (code: string) => execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();

// Real encoded media from OpenCV (no metadata of its own).
py(`import cv2, numpy as np
rng = np.random.default_rng(1)
img = (rng.random((240, 320, 3)) * 255).astype(np.uint8)
cv2.imwrite("${dir}/base.jpg", img); cv2.imwrite("${dir}/base.png", img); cv2.imwrite("${dir}/base.webp", img, [cv2.IMWRITE_WEBP_QUALITY, 90])
vw = cv2.VideoWriter("${dir}/base.webm", cv2.VideoWriter_fourcc(*"VP80"), 10, (320, 240))
[vw.write(np.roll(img, k * 5, axis=1)) for k in range(20)]; vw.release()`);
const file = (n: string) => readFileSync(path.join(dir, n));
/** Decode both files with OpenCV and return "same" when pixel arrays are identical. */
function samePixels(a: Buffer, b: Buffer, ext: string) {
  writeFileSync(path.join(dir, `a.${ext}`), a);
  writeFileSync(path.join(dir, `b.${ext}`), b);
  return py(`import cv2, numpy as np
a = cv2.imread("${dir}/a.${ext}", cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION); b = cv2.imread("${dir}/b.${ext}", cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
print("same" if a is not None and b is not None and a.shape == b.shape and np.array_equal(a, b) else "different")`);
}

import { app, exifTiff, withMetadata } from "./exif-fixture";
const jpegWithMetadata = (o = 6) => withMetadata(file("base.jpg"), o);

describe("JPEG", () => {
  it("removes EXIF/GPS/XMP/IPTC/comments and trailing data; keeps pixels and orientation", () => {
    const dirty = jpegWithMetadata(6);
    const { data, signals } = sanitize(dirty, "image/jpeg");
    const text = data.toString("latin1");
    for (const leak of ["Canon", "EOS R5", "SN-0042424242", "Photoshop", "jane", "hidden zip", "GPS", "40/1"]) expect(text).not.toContain(leak);
    expect(signals).toMatchObject({ hadExif: true, hadGps: true, hadXmp: true, hadCameraMakeModel: true, dateTimeOriginalPresent: true, editorDetected: true, orientation: 6, width: 320, height: 240 });
    expect(signals.software).toBe("Adobe Photoshop 25.0");
    expect(signals.trailingBytesRemoved).toBeGreaterThan(0);
    expect(samePixels(file("base.jpg"), data, "jpg")).toBe("same");
    // orientation preserved via a minimal EXIF holding only Orientation
    const again = sanitize(data, "image/jpeg").signals;
    expect([again.orientation, again.hadGps, again.hadCameraMakeModel, again.software]).toEqual([6, false, false, null]);
  });

  it("an image without metadata passes through unchanged", () => {
    const clean = file("base.jpg");
    expect(sanitize(clean, "image/jpeg").data.equals(clean)).toBe(true);
  });

  it("rejects truncated files and decompression bombs", () => {
    const b = file("base.jpg");
    expect(() => sanitize(b.subarray(0, b.length - 400), "image/jpeg")).toThrow(MetadataError);
    const bomb = Buffer.from(b);
    const sof = bomb.indexOf(Buffer.from([0xff, 0xc0]));
    bomb.writeUInt16BE(60000, sof + 5); // height
    bomb.writeUInt16BE(60000, sof + 7); // width
    try { sanitize(bomb, "image/jpeg"); throw new Error("not rejected"); } catch (e) { expect((e as MetadataError).code).toBe("too_many_pixels"); }
  });
});

function pngChunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

describe("PNG", () => {
  it("drops text/eXIf/tIME chunks and trailing data, keeps pixels", () => {
    const base = file("base.png");
    const iend = base.length - 12;
    const dirty = Buffer.concat([
      base.subarray(0, 33),
      pngChunk("tEXt", Buffer.from("Software\0GIMP 2.10", "latin1")),
      pngChunk("tEXt", Buffer.from("Author\0Jane Collector", "latin1")),
      pngChunk("eXIf", exifTiff(1)),
      pngChunk("tIME", Buffer.alloc(7)),
      base.subarray(33, iend), base.subarray(iend), Buffer.from("trailing-secret"),
    ]);
    const { data, signals } = sanitize(dirty, "image/png");
    const text = data.toString("latin1");
    for (const leak of ["Jane", "GIMP", "Canon", "trailing-secret", "tIME"]) expect(text).not.toContain(leak);
    expect(signals).toMatchObject({ hadExif: true, hadGps: true, editorDetected: true, width: 320, height: 240 });
    expect(samePixels(base, data, "png")).toBe("same");
  });
  it("rejects a PNG without IEND", () => {
    const b = file("base.png");
    expect(() => sanitize(b.subarray(0, b.length - 12), "image/png")).toThrow(/truncated/);
  });
});

describe("WebP", () => {
  it("removes EXIF/XMP chunks, clears VP8X flags, keeps pixels", () => {
    const base = file("base.webp");
    const vp8 = base.subarray(12); // simple-format VP8/VP8L chunk(s)
    const vp8x = Buffer.alloc(18);
    vp8x.write("VP8X", 0, "latin1"); vp8x.writeUInt32LE(10, 4); vp8x[8] = 0x08 | 0x04;
    vp8x.writeUIntLE(319, 12, 3); vp8x.writeUIntLE(239, 15, 3);
    const exifData = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exifTiff(1)]);
    const exif = Buffer.concat([Buffer.from("EXIF", "latin1"), Buffer.alloc(4), exifData, exifData.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    exif.writeUInt32LE(exifData.length, 4);
    const xmpData = Buffer.from('<x:xmpmeta xmp:CreatorTool="Snapseed"/>', "latin1");
    const xmp = Buffer.concat([Buffer.from("XMP ", "latin1"), Buffer.alloc(4), xmpData, xmpData.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    xmp.writeUInt32LE(xmpData.length, 4);
    const body = Buffer.concat([Buffer.from("WEBP", "latin1"), vp8x, vp8, exif, xmp]);
    const dirty = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), body]);
    dirty.writeUInt32LE(body.length, 4);
    const { data, signals } = sanitize(dirty, "image/webp");
    expect(data.toString("latin1")).not.toMatch(/Canon|Snapseed|EXIF|XMP /);
    expect(data[12 + 8] & 0x0c).toBe(0);
    expect(data.readUInt32LE(4)).toBe(data.length - 8);
    expect(signals).toMatchObject({ hadExif: true, hadGps: true, editorDetected: true, width: 320, height: 240 });
    expect(samePixels(base, data, "webp")).toBe("same");
  });
});

function box(type: string, ...children: Buffer[]) {
  const body = Buffer.concat(children);
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, "latin1");
  return Buffer.concat([h, body]);
}

describe("MP4/MOV", () => {
  it("neutralises location/device boxes in place without changing offsets", () => {
    const loc = box("©xyz", Buffer.from("\0\x11\x15\xc7+40.7128-074.0060/", "latin1"));
    const mak = box("©mak", Buffer.from("\0\x05\x15\xc7Apple", "latin1"));
    const dirty = Buffer.concat([
      box("ftyp", Buffer.from("qt  \0\0\0\0qt  ", "latin1")),
      box("moov", box("mvhd", Buffer.alloc(100)), box("udta", loc, mak), box("trak", box("tkhd", Buffer.alloc(84)), box("meta", Buffer.from("com.apple.quicktime.location.ISO6709 +40.71-074.00", "latin1")))),
      box("mdat", Buffer.alloc(64, 7)),
    ]);
    const { data, signals } = sanitize(dirty, "video/quicktime");
    expect(data.length).toBe(dirty.length);
    expect(data.toString("latin1")).not.toMatch(/40\.71|Apple|ISO6709/);
    expect(data.toString("latin1")).toContain("free");
    expect(data.subarray(data.length - 64).equals(dirty.subarray(dirty.length - 64))).toBe(true); // media untouched
    expect(signals).toMatchObject({ hadGps: true, hadCameraMakeModel: true });
    expect(signals.removed).toEqual(expect.arrayContaining(["udta", "meta"]));
  });
});

describe("WebM", () => {
  it("voids Tags elements and stays decodable", () => {
    const base = file("base.webm");
    // splice a Tags element (with an address) right after the Segment header
    const seg = base.indexOf(Buffer.from([0x18, 0x53, 0x80, 0x67]));
    const sizeLen = (() => { let l = 1; while (!(base[seg + 4] & (0x80 >> (l - 1)))) l++; return l; })();
    const tagBody = Buffer.from("TITLE 123 Main St, Springfield", "latin1");
    const tags = Buffer.concat([Buffer.from([0x12, 0x54, 0xc3, 0x67, 0x80 | tagBody.length]), tagBody]);
    const unknownSize = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const dirty = Buffer.concat([base.subarray(0, seg + 4), unknownSize, tags, base.subarray(seg + 4 + sizeLen)]);
    const { data, signals } = sanitize(dirty, "video/webm");
    expect(data.length).toBe(dirty.length);
    expect(data.toString("latin1")).not.toContain("Main St");
    expect(signals.removed).toContain("Tags");
    writeFileSync(path.join(dir, "clean.webm"), data);
    expect(Number(py(`import cv2
c = cv2.VideoCapture("${dir}/clean.webm"); n = 0
while c.read()[0]: n += 1
print(n)`))).toBeGreaterThan(5);
  });
});
