import { monthlyEquivalentCents } from "@slabguard/core";
import { q } from "./db";
import { loadPlans } from "./plans";

/** Internal unit economics. Admin-only; never exposed to customers. */
export async function adminMetrics(days = 30) {
  const plans = await loadPlans();
  const [users] = await q(`select count(*)::int total, count(*) filter (where created_at > now() - make_interval(days => $1))::int recent from app_users where deleted_at is null`, [days]);
  const active = await q(
    `select s.user_id, s.plan_id, s.price_id, s.provider, s.status from user_subscriptions s
      where s.status in ('active','trialing','past_due') or (s.status='canceled' and s.current_period_end > now())`,
  );
  const paidUsers = new Set(active.map((a) => a.user_id));
  let mrrCents = 0;
  for (const a of active) {
    if (a.status === "canceled") continue; // won't renew
    const price = plans.flatMap((p) => p.prices).find((p) => p.id === a.price_id);
    if (price) mrrCents += monthlyEquivalentCents(price);
  }
  const [churn] = await q(
    `select count(*) filter (where status in ('expired','refunded') and updated_at > now() - make_interval(days => $1))::int churned,
            count(*) filter (where cancel_at_period_end or status='canceled')::int pending_cancel from user_subscriptions`,
    [days],
  );
  const [conv] = await q(`select count(distinct user_id)::int ever_paid from user_subscriptions`);
  const byPlan = await q(
    `select coalesce(e.plan_id,'free') plan_id, count(*)::int sessions,
            count(*) filter (where s.credit_state='consumed')::int billable,
            count(*) filter (where s.status='failed')::int failed
       from verification_sessions s left join account_entitlements e on e.user_id=s.user_id
      where s.created_at > now() - make_interval(days => $1) group by 1 order by 1`,
    [days],
  );
  const costs = await q(
    `select item, sum(cost_usd)::float cost, count(distinct session_id)::int sessions from processing_costs where created_at > now() - make_interval(days => $1) group by item`,
    [days],
  );
  const [cs] = await q(`select count(distinct session_id)::int n, coalesce(sum(cost_usd),0)::float total from processing_costs where created_at > now() - make_interval(days => $1)`, [days]);
  const [pay] = await q(
    `select coalesce(sum(amount_cents) filter (where status in ('succeeded','refunded','partially_refunded','disputed','dispute_won','dispute_lost')),0)::int gross,
            coalesce(sum(refunded_cents),0)::int refunded, count(*) filter (where status like 'dispute%' or status='disputed')::int disputes,
            count(*) filter (where status in ('refunded','partially_refunded'))::int refunds, count(*) filter (where status='succeeded')::int succeeded
       from payments where occurred_at > now() - make_interval(days => $1)`,
    [days],
  );
  const totalSessions = byPlan.reduce((a, b) => a + b.sessions, 0);
  const billable = byPlan.reduce((a, b) => a + b.billable, 0);
  const failed = byPlan.reduce((a, b) => a + b.failed, 0);
  const costPerVerification = cs.n ? cs.total / cs.n : 0;
  const revenuePerVerification = billable ? (pay.gross - pay.refunded) / 100 / billable : 0;
  const per = (item: string) => {
    const c = costs.find((x) => x.item === item);
    return c && cs.n ? c.cost / cs.n : 0;
  };
  return {
    windowDays: days,
    users: { total: users.total, newInWindow: users.recent, paid: paidUsers.size, free: users.total - paidUsers.size },
    conversion: { everPaid: conv.ever_paid, freeToPaidRate: users.total ? conv.ever_paid / users.total : 0 },
    revenue: { mrr: mrrCents / 100, arr: (mrrCents * 12) / 100, arppu: paidUsers.size ? mrrCents / 100 / paidUsers.size : 0, grossInWindow: pay.gross / 100, refundedInWindow: pay.refunded / 100 },
    churn: { churnedInWindow: churn.churned, pendingCancellations: churn.pending_cancel, rate: paidUsers.size + churn.churned ? churn.churned / (paidUsers.size + churn.churned) : 0 },
    verifications: { total: totalSessions, billable, failed, failedRate: totalSessions ? failed / totalSessions : 0, byPlan },
    costs: {
      avgPerVerification: costPerVerification,
      avgCompute: per("vision_cpu_second"), avgOcr: per("google_vision_text_detection") + per("ocr_call_local"), avgStorage: per("storage_gb_month"),
      avgImageSearch: per("google_vision_web_detection"), avgAi: per("multimodal_ai_call") + per("ai_narrative"), lines: costs,
      note: "Estimated from config/costs.json rates; reconcile against provider invoices before changing allowances.",
    },
    margin: { avgRevenuePerVerification: revenuePerVerification, avgContributionPerVerification: revenuePerVerification - costPerVerification },
    payments: { refunds: pay.refunds, disputes: pay.disputes, refundRate: pay.succeeded ? pay.refunds / pay.succeeded : 0 },
  };
}
