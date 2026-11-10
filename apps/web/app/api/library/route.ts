import { handle, json } from "@/lib/http";
import { loadLibrary, publicLibraryView } from "@/lib/library";

/** Public: categories (with capture guidance) and graders from the published library.
 * Detection markers and internal notes are deliberately excluded. */
export const GET = handle(async () => json(publicLibraryView(await loadLibrary())));
