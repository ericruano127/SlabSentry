import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Private image storage. Supabase Storage (private bucket) when configured, local disk otherwise. */
interface Store {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  removePrefix(prefix: string): Promise<void>;
}

const local: Store = {
  async put(key, data) {
    const p = safe(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  get: (key) => readFile(safe(key)),
  removePrefix: (prefix) => rm(safe(prefix), { recursive: true, force: true }),
};

function safe(key: string) {
  const p = path.resolve(env.localStorageDir, key);
  if (!p.startsWith(path.resolve(env.localStorageDir) + path.sep)) throw new Error("invalid storage key");
  return p;
}

let sb: SupabaseClient | null = null;
const supa: Store = {
  async put(key, data, mime) {
    const { error } = await client().storage.from(env.storageBucket).upload(key, data, { contentType: mime, upsert: false });
    if (error) throw error;
  },
  async get(key) {
    const { data, error } = await client().storage.from(env.storageBucket).download(key);
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  },
  async removePrefix(prefix) {
    const b = client().storage.from(env.storageBucket);
    for (;;) {
      const { data } = await b.list(prefix, { limit: 100 });
      if (!data?.length) break;
      // nested folders: sessions/<id>/...
      const files = data.filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
      for (const d of data.filter((f) => !f.id)) await supa.removePrefix(`${prefix}/${d.name}`);
      if (!files.length) break;
      await b.remove(files);
    }
  },
};
function client() {
  return (sb ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } }));
}

export const storage: Store = env.supabaseUrl && env.supabaseServiceKey ? supa : local;
