import pg from "pg";
import { env } from "./env";

// Return timestamptz as ISO strings and numerics as numbers.
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

const g = globalThis as unknown as { __pool?: pg.Pool };
export const pool: pg.Pool = g.__pool ?? (g.__pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 }));

export type Q = Pick<pg.PoolClient, "query">;

export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = [], c: Q = pool): Promise<T[]> {
  return (await c.query<T>(sql, params)).rows;
}
export async function one<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = [], c: Q = pool): Promise<T | null> {
  return (await c.query<T>(sql, params)).rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Serialize all credit/subscription mutations for one user within a transaction. */
export async function lockUser(c: Q, userId: string) {
  await c.query("select pg_advisory_xact_lock(hashtextextended($1, 42))", [userId]);
}
