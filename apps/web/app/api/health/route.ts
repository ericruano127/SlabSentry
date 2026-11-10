/** Liveness: the process is up (no dependencies checked — never restart pods for a DB blip). */
export const GET = () => Response.json({ ok: true, ts: new Date().toISOString() });
