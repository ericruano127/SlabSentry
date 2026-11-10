import { z } from "zod";
import { q } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";

/** Internal log of newly reported counterfeit techniques and grader security changes → patches. */
const Body = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(10000),
  categories: z.array(z.string()).default([]),
  graders: z.array(z.string()).default([]),
  generations: z.array(z.string()).default([]),
  firstSeen: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.string().min(3).max(500),
  status: z.enum(["reported", "confirmed", "mitigated", "not_reproducible"]).default("reported"),
  mitigationRelease: z.string().max(40).nullable().optional(),
});

export const GET = handle(async (req: Request) => {
  await requirePermission(req, "quality:read");
  return json({ techniques: await q(`select * from counterfeit_techniques order by updated_at desc limit 200`) });
});

export const POST = handle(async (req: Request) => {
  const u = await requirePermission(req, "quality:label");
  const b = Body.parse(await req.json());
  const r = (await q(`insert into counterfeit_techniques (title,description,categories,graders,generations,first_seen,source,status,mitigation_release,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [b.title, b.description, b.categories, b.graders, b.generations, b.firstSeen ?? null, b.source, b.status, b.mitigationRelease ?? null, u.id]))[0];
  return json(r, 201);
});

export const PATCH = handle(async (req: Request) => {
  await requirePermission(req, "quality:label");
  const b = z.object({ id: z.string().uuid(), status: Body.shape.status, mitigationRelease: z.string().max(40).nullable().optional() }).parse(await req.json());
  await q(`update counterfeit_techniques set status=$2, mitigation_release=coalesce($3,mitigation_release), updated_at=now() where id=$1`, [b.id, b.status, b.mitigationRelease ?? null]);
  return json({ ok: true });
});
