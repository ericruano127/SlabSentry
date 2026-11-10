import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { acceptConsent, consentStatus, setTrainingConsent } from "@/lib/consent";
import { handle, json } from "@/lib/http";

const source = (req: Request) => (req.headers.get("x-client") === "mobile" ? "mobile" : "web") as "web" | "mobile";

export const GET = handle(async (req: Request) => {
  const u = await requireUser(req, { skipConsent: true });
  return json(await consentStatus(u.id, u.row as any));
});

/** Accept the current Terms + Privacy (versions echoed back) and optionally choose training consent. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser(req, { skipConsent: true });
  const b = z.object({ terms: z.string(), privacy: z.string(), training: z.boolean().optional() }).parse(await req.json());
  return json(await acceptConsent(u.id, b, source(req), req.headers.get("user-agent")));
});

/** Change training consent at any time (opting out never limits features). */
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser(req, { skipConsent: true });
  const { training } = z.object({ training: z.boolean() }).parse(await req.json());
  return json(await setTrainingConsent(u.id, training, source(req), req.headers.get("user-agent")));
});
