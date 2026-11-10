import { DEFAULT_LIBRARY } from "./default";
import { LibrarySchema, type Category, type Feature, type Generation, type GraderDef, type LibraryData } from "./schema";

export interface LibraryMeta {
  version: string;
  sha256: string | null; // content hash of the published release (null for the built-in seed)
}

/** Indexed, ready-to-use library. Build once per release; pass into every analysis. */
export interface CompiledLibrary {
  meta: LibraryMeta;
  data: LibraryData;
  category(id: string | null | undefined): Category;
  grader(id: string): GraderDef | undefined;
  gradersFor(category?: string | null): GraderDef[];
  generationsFor(graderId: string, category?: string | null): Generation[];
  feature(id: string): Feature | undefined;
  certPatterns(graderId: string, category?: string | null): RegExp[];
}

export function compileLibrary(raw: unknown, meta: LibraryMeta): CompiledLibrary {
  const data = LibrarySchema.parse(raw);
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const graders = new Map(data.graders.map((g) => [g.id, g]));
  const feats = new Map(data.features.map((f) => [f.id, f]));
  const unknownCategory = cats.get("other_collectibles") ?? data.categories[0];
  const defaultCategory = data.categories.find((c) => c.launchStatus === "supported") ?? data.categories[0];
  const patterns = new Map<string, { category: string | null; re: RegExp }[]>();
  for (const g of data.graders) patterns.set(g.id, g.certPatterns.map((p) => ({ category: p.category, re: new RegExp(p.pattern, "i") })));
  return {
    meta,
    data,
    // No category given (legacy sessions) → first supported category; unknown id → generic "other".
    category: (id) => (!id ? defaultCategory : cats.get(id) ?? unknownCategory),
    grader: (id) => graders.get(id),
    gradersFor: (category) => data.graders.filter((g) => !category || g.categories.includes(category)).sort((a, b) => a.priority - b.priority),
    generationsFor: (graderId, category) => data.generations.filter((g) => g.graderId === graderId && (!category || g.categories.includes(category))),
    feature: (id) => feats.get(id),
    certPatterns: (graderId, category) => {
      const ps = patterns.get(graderId) ?? [];
      const specific = ps.filter((p) => p.category && p.category === category);
      return (specific.length ? specific : ps.filter((p) => !p.category)).map((p) => p.re);
    },
  };
}

/** Deterministic JSON (sorted keys) so the same content always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export const BUILTIN_LIBRARY_VERSION = "builtin-seed";
let builtin: CompiledLibrary | null = null;
/** Built-in seed (tests, first boot). Production analysis uses the published DB release. */
export function defaultLibrary(): CompiledLibrary {
  return (builtin ??= compileLibrary(DEFAULT_LIBRARY, { version: BUILTIN_LIBRARY_VERSION, sha256: null }));
}
