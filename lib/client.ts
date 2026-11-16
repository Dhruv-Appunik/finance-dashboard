"use client";

import { useCallback, useEffect, useState } from "react";

export type Owner = "personal" | "business";
export type AccountRow = { id: number; name: string; bank: string; type: "savings" | "current" | "credit_card"; last4: string | null; default_owner: Owner };
export type CategoryRow = { id: number; name: string; grp: string; is_spend: number };
export type Meta = {
  accounts: AccountRow[];
  categories: CategoryRow[];
  months: string[];
  open_questions: number;
  transaction_count: number;
  keys: { jev: boolean; claude: boolean };
  settings: { own_names: string; confidence_threshold: string };
};

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const opts: RequestInit = { ...init };
  if (init?.json !== undefined) {
    opts.method = opts.method || "POST";
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(init.json);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/** Loads JSON from a URL and exposes a reload function. A null URL skips the request. */
export function useData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    api<T>(url)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: Error) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Tells the navigation badge to refresh after something changed the question count. */
export const notifyChanged = () => window.dispatchEvent(new Event("finance:changed"));
