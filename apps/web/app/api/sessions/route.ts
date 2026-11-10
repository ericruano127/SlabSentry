import { z } from "zod";
import { hasFeature } from "@slabguard/core";
import { requireUser } from "@/lib/auth";
import { entitlementsFor } from "@/lib/credits";
import { one } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { loadLibrary } from "@/lib/library";
import { rateLimit } from "@/lib/ratelimit";
import { listUserSessions } from "@/lib/users";

export const GET = handle(async (req: Request) => {
  const u = await requireUser(req);
  const url = new URL(req.url);
  const { ent } = await entitlementsFor(u.id);
  const search = hasFeature(ent, "advanced_history_search") ? url.searchParams.get("q") ?? undefined : undefined;
  return json({ sessions: await listUserSessions(u.id, search, hasFeature(ent, "advanced_history_search") ? 500 : 100), searchEnabled: hasFeature(ent, "advanced_history_search") });
});

const Body = z.object({ mode: z.enum(["in_hand", "online_listing"]).default("in_hand"), category: z.string().regex(/^[a-z0-9_]+$/).optional() });

// Creating a session is free; credits are reserved only when analysis starts.
export const POST = handle(async (req: Request) => {
  const u = await requireUser(req);
  await rateLimit(`create:${u.id}`, 30, 3600);
  const { mode, category: requested } = Body.parse(await req.json().catch(() => ({})));
  const lib = await loadLibrary();
  if (requested && !lib.data.categories.some((c) => c.id === requested)) throw new HttpError(400, "invalid_category", "Unknown category.");
  const category = lib.category(requested).id;
  const s = await one(`insert into verification_sessions (user_id,mode,category) values ($1,$2,$3) returning id`, [u.id, mode, category]);
  return json({ id: s.id }, 201);
});
