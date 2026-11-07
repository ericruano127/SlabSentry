import { one, q, tx, lockUser } from "./db";

/** Idempotently create the app user and grant the lifetime free allowance once. */
export async function ensureUser(id: string, email: string | null) {
  const existing = await one(`select * from app_users where id=$1`, [id]);
  if (existing) return existing;
  return tx(async (c) => {
    await lockUser(c, id);
    const row = await one(`insert into app_users (id,email) values ($1,$2) on conflict (id) do update set email=coalesce(app_users.email, excluded.email) returning *`, [id, email], c);
    const free = await one(`select lifetime_allowance from subscription_plans where id='free'`, [], c);
    await c.query(
      `insert into verification_allowances (user_id,kind,plan_id,period_start,granted) values ($1,'lifetime_free','free','1970-01-01T00:00:00Z',$2)
       on conflict (user_id,kind,period_start) do nothing`,
      [id, free?.lifetime_allowance ?? 3],
    );
    return row;
  });
}

export async function isNewUser(id: string) {
  const r = await one(`select created_at from app_users where id=$1`, [id]);
  return r ? Date.now() - new Date(r.created_at).getTime() < 10 * 60_000 : false;
}

export async function listUserSessions(userId: string, search?: string, limit = 50) {
  return q(
    `select s.id, s.mode, s.status, s.grader, s.cert_number, s.title, s.overall_assessment, s.credit_state, s.created_at, s.completed_at
       from verification_sessions s where s.user_id=$1 and s.status <> 'canceled'
        and ($2::text is null or s.cert_number ilike '%'||$2||'%' or s.title ilike '%'||$2||'%' or s.grader ilike $2 or s.overall_assessment ilike '%'||$2||'%')
      order by s.created_at desc limit $3`,
    [userId, search || null, limit],
  );
}
