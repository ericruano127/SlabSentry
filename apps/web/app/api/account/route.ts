import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { loadSubscriptions } from "@/lib/credits";
import { tx } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, HttpError, json } from "@/lib/http";
import { storage } from "@/lib/storage";
import { deleteUserSightings } from "@/lib/cert-sightings";
import { subscriptionGrantsAccess } from "@slabguard/core";

/** Permanently delete the account, photos and reports. Store subscriptions must be canceled in the store. */
export const DELETE = handle(async (req: Request) => {
  const u = await requireUser(req, { skipConsent: true });
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") throw new HttpError(400, "confirm_required", 'Type DELETE to confirm.');
  const active = (await loadSubscriptions(u.id)).filter((s) => subscriptionGrantsAccess(s, new Date()) && !["canceled"].includes(s.status));
  if (active.some((s) => s.provider === "stripe") && env.stripeSecret) {
    const { stripe } = await import("@/lib/billing/stripe");
    for (const s of await tx(async (c) => (await c.query(`select provider_subscription_id from user_subscriptions where user_id=$1 and provider='stripe'`, [u.id])).rows))
      await stripe().subscriptions.cancel(s.provider_subscription_id).catch(() => {});
  }
  await storage.removePrefix(u.id);
  await deleteUserSightings(u.id);
  await tx(async (c) => {
    await c.query(`insert into privacy_requests (user_id,kind,status,completed_at) values ($1,'deletion','completed',now())`, [u.id]);
    // Billing/payment rows are retained (user_id nulled) for accounting; everything else cascades.
    await c.query(`update payments set user_id=null where user_id=$1`, [u.id]);
    await c.query(`update billing_events set user_id=null where user_id=$1`, [u.id]);
    await c.query(`delete from app_users where id=$1`, [u.id]);
  });
  if (env.supabaseUrl && env.supabaseServiceKey) {
    await createClient(env.supabaseUrl, env.supabaseServiceKey).auth.admin.deleteUser(u.id);
  }
  return json({ deleted: true, storeSubscriptionsNote: active.some((s) => s.provider !== "stripe") ? "Cancel your App Store / Google Play subscription in the store to stop renewals." : null });
});
