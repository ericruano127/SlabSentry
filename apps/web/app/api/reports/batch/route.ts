import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { pdfForSessions } from "@/lib/report-access";

export const POST = handle(async (req: Request) => {
  const u = await requireUser(req);
  const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(await req.json());
  const pdf = await pdfForSessions(u.id, ids, "batch_pdf_export");
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="slab-reports.pdf"` } });
});
