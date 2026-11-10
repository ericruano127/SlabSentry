import { z } from "zod";

/** Plan configuration. Source of truth at runtime is the database (editable by
 * admins); config/plans.json seeds it. No prices/allowances are hard-coded in app logic. */
export const FEATURE_KEYS = [
  "full_workflow",
  "cert_lookup",
  "basic_report",
  "history",
  "advanced_reference_comparison",
  "holder_security_analysis",
  "reverse_image",
  "guided_refinement",
  "detailed_report",
  "pdf_export",
  "bulk_verification",
  "advanced_history_search",
  "scan_queue",
  "batch_pdf_export",
  "priority_processing",
  "market_value",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const PriceSchema = z.object({
  id: z.string(),
  interval: z.enum(["month", "year"]),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  stripePriceId: z.string().nullable().optional(),
  appleProductId: z.string().nullable().optional(),
  googleProductId: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export const PlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  tagline: z.string().default(""),
  rank: z.number().int(), // higher = more capable; used for upgrade/downgrade direction
  monthlyAllowance: z.number().int().nonnegative(), // 0 for free
  lifetimeAllowance: z.number().int().nonnegative(), // free lifetime credits granted (never reset)
  features: z.array(z.enum(FEATURE_KEYS)),
  marketingBullets: z.array(z.string()).default([]),
  prices: z.array(PriceSchema),
  active: z.boolean().default(true),
});
export type Plan = z.infer<typeof PlanSchema>;
export type Price = z.infer<typeof PriceSchema>;
export const PlansConfigSchema = z.object({ version: z.number().int(), plans: z.array(PlanSchema).min(1) });

export function validatePlansConfig(json: unknown) {
  const cfg = PlansConfigSchema.parse(json);
  if (!cfg.plans.some((p) => p.id === "free")) throw new Error("plans config must include a 'free' plan");
  const ids = new Set<string>();
  for (const p of cfg.plans) {
    if (ids.has(p.id)) throw new Error(`duplicate plan id ${p.id}`);
    ids.add(p.id);
  }
  return cfg;
}

export function monthlyEquivalentCents(price: Price): number {
  return price.interval === "year" ? Math.round(price.amountCents / 12) : price.amountCents;
}

export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
