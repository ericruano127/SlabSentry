"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { devSignOut, hasDevSession, supabase } from "@/lib/client/supabase";

export function Nav() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const sb = supabase();
    if (!sb) return setSignedIn(hasDevSession());
    sb.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => data.subscription.unsubscribe();
  }, [path]);
  const link = (href: string, label: string) => (
    <Link href={href} className={path?.startsWith(href) ? "active" : ""}>{label}</Link>
  );
  const signOut = async () => {
    await supabase()?.auth.signOut();
    devSignOut();
    location.href = "/";
  };
  return (
    <nav className="nav" aria-label="Main">
      <div className="container">
        <Link href={signedIn ? "/dashboard" : "/"} className="brand"><span className="brand-mark" aria-hidden />SlabGuard</Link>
        <div className="nav-links">
          {signedIn ? (<>{link("/dashboard", "Dashboard")}{link("/scan", "Scan")}{link("/history", "History")}{link("/pricing", "Plans")}{link("/account", "Account")}</>) : link("/pricing", "Pricing")}
        </div>
        {signedIn ? <button className="btn" onClick={signOut}>Sign out</button> : <Link className="btn primary" href="/login">Sign in</Link>}
      </div>
    </nav>
  );
}
