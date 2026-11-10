/**
 * Compatibility view over the data-driven reference library (library/). The runtime source of truth
 * is the published library release in the database; these exports reflect the built-in seed.
 */
import { DEFAULT_LIBRARY } from "../library/default";
import { defaultLibrary } from "../library/runtime";
import type { ClaimStatus, Feature, Generation } from "../library/schema";
import type { GraderId } from "../types";

export type { ClaimStatus };
export type SecurityFeature = Feature;
export type HolderGeneration = Generation;
export type AnalysisMethod = Feature["methods"][number];

export const SECURITY_FEATURES: Record<string, Feature> = Object.fromEntries(DEFAULT_LIBRARY.features.map((f) => [f.id, f]));
export const HOLDER_GENERATIONS: Generation[] = DEFAULT_LIBRARY.generations;
export function generationsFor(grader: GraderId, category?: string): Generation[] {
  return defaultLibrary().generationsFor(grader, category);
}
