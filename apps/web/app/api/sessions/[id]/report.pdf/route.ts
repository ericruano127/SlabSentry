import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { pdfForSessions } from "@/lib/report-access";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  const id = (await ctx.params).id;
  const pdf = await pdfForSessions(u.id, [id], "pdf_export");
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="slab-report-${id.slice(0, 8)}.pdf"` } });
});
