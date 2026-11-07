import { useEffect, useState } from "react";
import { Alert, Linking, Platform, ScrollView, View } from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { api, type Me } from "../lib/api";
import { buy, loadPackages, restore } from "../lib/purchases";
import { Button, Card, T, useTheme } from "../lib/ui";

type Plan = { id: string; name: string; tagline: string; monthlyAllowance: number; lifetimeAllowance: number; marketingBullets: string[]; prices: { interval: string; appleProductId?: string; googleProductId?: string }[] };

/**
 * Native paywall. Prices shown come from the store (localized, tax-inclusive where applicable);
 * allowances/features come from the server plan config. No auto-enrollment, no trials by default.
 */
export default function Paywall() {
  const t = useTheme();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pkgs, setPkgs] = useState<PurchasesPackage[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<{ plans: Plan[] }>("/api/plans").then((r) => setPlans(r.plans));
    api<Me>("/api/me").then(setMe);
    loadPackages().then(setPkgs).catch(() => setPkgs([]));
  }, []);
  const productFor = (p: Plan) => {
    const price = p.prices.find((x) => x.interval === interval);
    const pid = Platform.OS === "ios" ? price?.appleProductId : price?.googleProductId;
    return pkgs.find((k) => k.product.identifier === pid || k.product.identifier === pid?.split(":")[0]);
  };
  const provider = me?.usage.subscriptionProvider;
  const onWeb = provider === "stripe";

  async function purchase(p: Plan) {
    const pkg = productFor(p);
    if (!pkg) return;
    setBusy(p.id);
    try {
      const r = await buy(pkg);
      setMe({ ...me!, usage: r.usage });
      Alert.alert("Thank you!", `You're on ${r.usage.planName}.`);
    } catch (e: any) {
      if (!e.userCancelled) Alert.alert("Purchase", e.message ?? "Purchase failed. You were not charged.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {me && <T>Current plan: <T bold>{me.usage.planName}</T> · {me.usage.totalRemaining} verifications available</T>}
      {onWeb && <Card><T>Your subscription is managed on the web. Sign in at our website to change or cancel it — it works on this device already.</T></Card>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="Monthly" primary={interval === "month"} onPress={() => setInterval("month")} /></View>
        <View style={{ flex: 1 }}><Button title="Annual" primary={interval === "year"} onPress={() => setInterval("year")} /></View>
      </View>
      {plans.filter((p) => p.id !== "free").map((p) => {
        const pkg = productFor(p);
        const current = me?.usage.planId === p.id;
        return (
          <Card key={p.id} style={{ gap: 8 }}>
            <T size={19} bold>{p.name}</T>
            <T muted>{p.tagline}</T>
            <T size={22} bold>{pkg ? `${pkg.product.priceString} / ${interval === "month" ? "month" : "year"}` : "Not available in this store yet"}</T>
            <T muted size={13}>{p.monthlyAllowance} verifications per month{interval === "year" ? ", renewed monthly" : ""}</T>
            {p.marketingBullets.map((b) => <T key={b} size={14}>• {b}</T>)}
            <Button primary={!current} title={current ? "Current plan" : `Subscribe to ${p.name}`} disabled={current || !pkg || onWeb} busy={busy === p.id} onPress={() => purchase(p)} />
          </Card>
        );
      })}
      <Button title="Restore purchases" onPress={async () => { try { const r = await restore(); setMe({ ...me!, usage: r.usage }); Alert.alert("Restore", `Plan: ${r.usage.planName}`); } catch (e: any) { Alert.alert("Restore", e.message); } }} />
      {provider && provider !== "stripe" && <Button title="Manage subscription" onPress={() => Linking.openURL(Platform.OS === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions")} />}
      <T muted size={12}>
        Payment is charged to your {Platform.OS === "ios" ? "Apple ID" : "Google Play"} account. Subscriptions renew automatically unless canceled at least 24 hours before the end of the period; manage or cancel in your store account settings. Unused monthly verifications don't roll over. Reports are photographic screenings and cannot guarantee authenticity.
      </T>
    </ScrollView>
  );
}
