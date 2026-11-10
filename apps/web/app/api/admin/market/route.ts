import { handle, json } from "@/lib/http";
import { providerStatus, sampleProviderResponse } from "@/lib/market";
import { requirePermission } from "@/lib/rbac";

/** Staff tool: provider status, and a raw sample response to confirm field names/units before enabling. */
export const GET = handle(async (req: Request) => {
  await requirePermission(req, "library:write");
  const q = new URL(req.url).searchParams.get("q");
  return json({ providers: providerStatus(), sample: q ? await sampleProviderResponse(q) : null });
});
