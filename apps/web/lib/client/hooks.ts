"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}

export type Me = {
  user: { id: string; email: string | null; isAdmin: boolean };
  welcome: boolean;
  usage: {
    planId: string; planName: string; features: string[]; periodAllowance: number; periodUsed: number; periodRemaining: number;
    freeGranted: number; freeUsed: number; freeRemaining: number; totalRemaining: number; renewsAt: string | null; windowEnd: string | null;
    willCancel: boolean; accessEndsAt: string | null; subscriptionProvider: string | null; billingInterval: string | null;
  };
};
