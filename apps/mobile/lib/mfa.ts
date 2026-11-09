import { supabase } from "./supabase";

/** True when the account has 2FA enrolled but this session hasn't passed the code step yet. */
export async function needsMfa() {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

export async function verifyMfa(code: string) {
  const f = (await supabase.auth.mfa.listFactors()).data?.totp.find((x) => x.status === "verified");
  if (!f) throw new Error("No authenticator found for this account.");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
  if (error) throw new Error("That code didn't work. Try the current code.");
}
