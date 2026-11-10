import { describe, expect, it } from "vitest";
import { analyzeFrame, hintsFor, type Frame } from "../lib/client/frame-analysis";

const W = 240, H = 320;
/** Synthetic frame: textured bright slab (optionally a trapezoid) on a dark background. */
function frame(o: { x0?: number; x1?: number; y0?: number; y1?: number; keystone?: number; noise?: number; shift?: number } = {}): Frame {
  const { x0 = 40, x1 = 200, y0 = 30, y1 = 290, keystone = 0, shift = 0 } = o;
  const gray = new Float32Array(W * H).fill(40);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    const inset = Math.round(keystone * t); // narrower at the bottom → camera not parallel
    for (let x = x0 + inset + shift; x < x1 - inset + shift; x++) {
      if (x < 0 || x >= W) continue;
      const label = y < y0 + (y1 - y0) * 0.2;
      gray[y * W + x] = label ? ((x >> 2) % 2 ? 230 : 120) : 170 + rnd() * 50;
    }
  }
  return { gray, w: W, h: H, glareFrac: 0 };
}

describe("live capture frame checks", () => {
  it("a well-framed, steady, straight slab is ready to auto-capture", () => {
    const f = frame();
    const c = analyzeFrame(f, frame());
    const { ready, hints } = hintsFor(c, "slab");
    expect(c.edgesInside).toBe(true);
    expect(c.fill).toBeGreaterThan(0.3);
    expect(c.tiltDeg).toBeLessThan(6);
    expect(ready).toBe(true);
    expect(hints.find((h) => h.key === "label")?.ok).toBe(true);
  });
  it("edges cut off by the frame → move back", () => {
    const c = analyzeFrame(frame({ x0: 0, x1: 240 }), null);
    const h = hintsFor(c, "slab");
    expect(h.ready).toBe(false);
    expect(h.hints.find((x) => x.key === "frame")?.text).toMatch(/Move back|Fit the whole slab/);
  });
  it("keystone (phone not parallel) is detected", () => {
    const c = analyzeFrame(frame({ keystone: 30 }), null);
    expect(c.tiltDeg).toBeGreaterThan(6);
    expect(hintsFor(c, "slab").hints.find((x) => x.key === "angle")?.ok).toBe(false);
  });
  it("movement between frames → hold steady", () => {
    const c = analyzeFrame(frame({ shift: 12 }), frame());
    expect(hintsFor(c, "slab").hints.find((x) => x.key === "steady")?.ok).toBe(false);
  });
  it("too small in frame → move closer", () => {
    const c = analyzeFrame(frame({ x0: 100, x1: 150, y0: 120, y1: 200 }), null);
    expect(hintsFor(c, "slab").hints.find((x) => x.key === "size")?.text).toBe("Move closer");
  });
});
