import { handle, json } from "@/lib/http";
import { publicReleaseNotes } from "@/lib/releases";

/** Public patch notes (general wording only) and the current version. */
export const GET = handle(async () => {
  const notes = await publicReleaseNotes();
  return json({ current: notes[0]?.version ?? null, releases: notes });
});
