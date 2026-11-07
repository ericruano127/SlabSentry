import { Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";
import { api } from "./api";
import { config } from "./config";

/**
 * StoreKit / Google Play Billing via RevenueCat. The app user id is our account id, so
 * a subscription bought on iOS is visible on Android and the web after sign-in.
 * Purchases are never trusted client-side: after each purchase/restore we ask the server
 * to reconcile with RevenueCat (/api/billing/sync) and display the server's answer.
 */
let configured = false;

export async function initPurchases(userId: string) {
  const apiKey = Platform.OS === "ios" ? config.revenuecatAppleKey : config.revenuecatGoogleKey;
  if (!apiKey) return false;
  if (!configured) {
    Purchases.configure({ apiKey, appUserID: userId });
    configured = true;
  } else {
    await Purchases.logIn(userId);
  }
  return true;
}

export async function logoutPurchases() {
  if (configured) await Purchases.logOut().catch(() => {});
}

export async function loadPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export async function buy(pkg: PurchasesPackage) {
  await Purchases.purchasePackage(pkg);
  return api("/api/billing/sync", { method: "POST" });
}

export async function restore() {
  await Purchases.restorePurchases();
  return api("/api/billing/sync", { method: "POST" });
}
