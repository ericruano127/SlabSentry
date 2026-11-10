/**
 * On-device live-capture checks (runs in the browser on a downscaled grayscale frame; nothing is
 * uploaded until capture). Pure functions so they can be unit-tested with synthetic frames.
 */
export interface Frame { gray: Float32Array; w: number; h: number; glareFrac: number }
export interface FrameChecks {
  sharp: number; labelSharp: number | null; mean: number; glare: number; motion: number; anisotropy: number;
  box: { x0: number; y0: number; x1: number; y1: number } | null; fill: number; edgesInside: boolean; tiltDeg: number;
}
export interface Hint { ok: boolean; text: string; key: string }

export function toFrame(rgba: Uint8ClampedArray, w: number, h: number): Frame {
  const gray = new Float32Array(w * h);
  let glare = 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (rgba[i] > 250 && rgba[i + 1] > 250 && rgba[i + 2] > 250) glare++;
  }
  return { gray, w, h, glareFrac: glare / (w * h) };
}

function lapVar(g: Float32Array, w: number, x0: number, y0: number, x1: number, y1: number) {
  let s = 0, s2 = 0, n = 0;
  for (let y = Math.max(1, y0); y < Math.min(y1, g.length / w - 1); y++)
    for (let x = Math.max(1, x0); x < Math.min(x1, w - 1); x++) {
      const p = y * w + x;
      const l = g[p - 1] + g[p + 1] + g[p - w] + g[p + w] - 4 * g[p];
      s += l; s2 += l * l; n++;
    }
  return n ? s2 / n - (s / n) ** 2 : 0;
}

/** Fit x = a + b·y (or y = a + b·x) by least squares; returns slope b. */
function slope(pts: [number, number][]) {
  const n = pts.length;
  if (n < 5) return 0;
  let st = 0, sv = 0, stt = 0, stv = 0;
  for (const [t, v] of pts) { st += t; sv += v; stt += t * t; stv += t * v; }
  const d = n * stt - st * st;
  return d ? (n * stv - st * sv) / d : 0;
}

export function analyzeFrame(f: Frame, prev: Frame | null): FrameChecks {
  const { gray: g, w, h } = f;
  let mean = 0;
  for (let i = 0; i < g.length; i++) mean += g[i];
  mean /= g.length;
  // gradients: magnitude for edge detection, structure tensor for motion-blur anisotropy
  const mag = new Float32Array(w * h);
  let jxx = 0, jyy = 0, jxy = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = g[p + 1] - g[p - 1], gy = g[p + w] - g[p - w];
      mag[p] = Math.hypot(gx, gy);
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
    }
  const tr = jxx + jyy;
  const anisotropy = tr > 1e-6 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / tr : 0;
  let motion = 0;
  if (prev && prev.w === w && prev.h === h) {
    for (let i = 0; i < g.length; i++) motion += Math.abs(g[i] - prev.gray[i]);
    motion /= g.length;
  }
  // Holder outline: outermost strong edges per row/column (the slab is the dominant object).
  const thr = 40;
  const left: [number, number][] = [], right: [number, number][] = [], top: [number, number][] = [], bottom: [number, number][] = [];
  for (let y = 2; y < h - 2; y++) {
    let a = -1, b = -1;
    for (let x = 2; x < w - 2; x++) if (mag[y * w + x] > thr) { if (a < 0) a = x; b = x; }
    if (a >= 0 && b - a > w * 0.2) { left.push([y, a]); right.push([y, b]); }
  }
  for (let x = 2; x < w - 2; x++) {
    let a = -1, b = -1;
    for (let y = 2; y < h - 2; y++) if (mag[y * w + x] > thr) { if (a < 0) a = y; b = y; }
    if (a >= 0 && b - a > h * 0.2) { top.push([x, a]); bottom.push([x, b]); }
  }
  const pct = (xs: number[], q: number) => { const s = [...xs].sort((m, n) => m - n); return s.length ? s[Math.floor((s.length - 1) * q)] : 0; };
  let box: FrameChecks["box"] = null, fill = 0, edgesInside = false, tiltDeg = 0, labelSharp: number | null = null;
  if (left.length > h * 0.15 && top.length > w * 0.15) {
    box = { x0: pct(left.map((p) => p[1]), 0.1), x1: pct(right.map((p) => p[1]), 0.9), y0: pct(top.map((p) => p[1]), 0.1), y1: pct(bottom.map((p) => p[1]), 0.9) };
    fill = Math.max(0, ((box.x1 - box.x0) * (box.y1 - box.y0)) / (w * h));
    const m = 0.02;
    edgesInside = box.x0 > w * m && box.x1 < w * (1 - m) && box.y0 > h * m && box.y1 < h * (1 - m);
    // keystone/tilt: opposite edges should be parallel and straight; use slopes of left/right and top/bottom
    const inRows = (p: [number, number]) => p[0] > box!.y0 + (box!.y1 - box!.y0) * 0.1 && p[0] < box!.y1 - (box!.y1 - box!.y0) * 0.1;
    const inCols = (p: [number, number]) => p[0] > box!.x0 + (box!.x1 - box!.x0) * 0.1 && p[0] < box!.x1 - (box!.x1 - box!.x0) * 0.1;
    const deg = (s: number) => (Math.atan(s) * 180) / Math.PI;
    tiltDeg = Math.max(
      Math.abs(deg(slope(left.filter(inRows))) - deg(slope(right.filter(inRows)))),
      Math.abs(deg(slope(top.filter(inCols))) - deg(slope(bottom.filter(inCols)))),
    );
    labelSharp = lapVar(g, w, box.x0, box.y0, box.x1, box.y0 + Math.round((box.y1 - box.y0) * 0.22));
  }
  return { sharp: lapVar(g, w, 0, 0, w, h), labelSharp, mean, glare: f.glareFrac, motion, anisotropy, box, fill, edgesInside, tiltDeg };
}

/** Human guidance; `ready` when every required check passes. */
export function hintsFor(c: FrameChecks, mode: "slab" | "closeup"): { hints: Hint[]; ready: boolean } {
  const hints: Hint[] = [];
  const add = (key: string, ok: boolean, good: string, bad: string) => hints.push({ key, ok, text: ok ? good : bad });
  add("steady", c.motion < 6 && !(c.anisotropy > 0.55 && c.sharp < 150), "Steady", "Hold steady");
  add("focus", c.sharp > 60, "In focus", "Tap to focus");
  add("light", c.mean > 60 && c.mean < 215, "Light OK", c.mean <= 60 ? "Too dark — add even light" : "Too bright — reduce direct light");
  add("glare", c.glare < 0.03, "No strong glare", "Glare — tilt slightly away from the light");
  if (mode === "slab") {
    add("frame", !!c.box && c.edgesInside, "All edges in frame", c.box ? "Move back — keep all four edges inside" : "Fit the whole slab in the frame");
    if (c.box) {
      add("size", c.fill > 0.3, "Good size", "Move closer");
      add("angle", c.tiltDeg < 6, "Straight on", "Hold the phone parallel to the slab");
      if (c.labelSharp !== null) add("label", c.labelSharp > 40, "Label sharp", "Focus on the label");
    }
  }
  return { hints, ready: hints.every((x) => x.ok) };
}
