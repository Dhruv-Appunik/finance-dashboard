"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Notice, Select } from "@/components/ui/form";
import { notifyChanged, useData, type Meta } from "@/lib/client";
import { cn, dateLabel, monthLabel } from "@/lib/utils";

type UploadData = {
  coverage: { account_id: number; month: string; n: number }[];
  uploads: { id: number; file_name: string; period_start: string; period_end: string; row_count: number; added_count: number; duplicate_count: number; account: string }[];
};
type Result = {
  rows: number; added: number; duplicates: number; period_start: string; period_end: string;
  classified: number; needs_review: number; warnings: string[];
};

/** Months of the Indian financial year so far: April of the starting year up to the current month. */
function financialYearMonths(): string[] {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const out: string[] = [];
  const d = new Date(startYear, 3, 1);
  while (d <= now) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export default function UploadPage() {
  const { data: meta } = useData<Meta>("/api/meta");
  const { data, reload } = useData<UploadData>("/api/upload");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const months = useMemo(() => financialYearMonths(), []);
  const cover = useMemo(() => {
    const m = new Map<string, number>();
    data?.coverage.forEach((c) => m.set(`${c.account_id}|${c.month}`, c.n));
    return m;
  }, [data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!accountId || !file) { setError("Choose an account and a file."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      form.set("account_id", accountId);
      form.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setResult(json);
      if (fileRef.current) fileRef.current.value = "";
      reload();
      notifyChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Upload" description="Add a statement for one account or card. Re-uploading an overlapping period is safe; duplicates are skipped." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="acc">Account or card</Label>
                <Select id="acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {meta?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ··${a.last4}` : ""}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="file">Statement file (.xlsx, .xls or .csv)</Label>
                <input id="file" ref={fileRef} type="file" accept=".csv,.xls,.xlsx,.txt"
                  className="block h-10 w-full rounded-md border border-input bg-card text-sm file:mr-3 file:h-full file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:text-sm file:font-medium" />
              </div>
              <Button type="submit" disabled={busy}>{busy ? "Reading…" : "Upload"}</Button>
            </form>
            <div className="mt-3 flex flex-col gap-2">
              {error && <Notice tone="error">{error}</Notice>}
              {result && (
                <Notice tone="success">
                  Read {result.rows} rows from {dateLabel(result.period_start)} to {dateLabel(result.period_end)}: {result.added} added, {result.duplicates} already loaded.{" "}
                  {result.added > 0 && <>{result.classified} sorted automatically, {result.needs_review} need your answer. </>}
                  {result.needs_review > 0 && <Link href="/questions" className="font-medium underline underline-offset-2">Answer questions</Link>}
                </Notice>
              )}
              {result?.warnings.map((w, i) => <Notice key={i} tone="error">{w}</Notice>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What is loaded</CardTitle>
            <CardDescription>Number of transactions per account for each month of this financial year. A dash means nothing is loaded for that month.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm tabular">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="sticky left-0 bg-card py-2 pr-3 font-medium">Account</th>
                  {months.map((m) => <th key={m} className="px-2 py-2 text-center font-medium">{monthLabel(m).slice(0, 3)}</th>)}
                </tr>
              </thead>
              <tbody>
                {meta?.accounts.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="sticky left-0 bg-card py-2 pr-3 whitespace-nowrap">{a.name}</td>
                    {months.map((m) => {
                      const n = cover.get(`${a.id}|${m}`);
                      return (
                        <td key={m} className="px-1 py-1.5 text-center">
                          <span className={cn("inline-block min-w-9 rounded px-1.5 py-0.5 text-xs", n ? "bg-muted font-medium" : "text-subtle")}>{n || "–"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent uploads</CardTitle></CardHeader>
          <CardContent>
            {data?.uploads.length ? (
              <ul className="flex flex-col text-sm">
                {data.uploads.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t py-2 first:border-t-0">
                    <span className="min-w-0"><span className="font-medium">{u.account}</span> <span className="break-all text-muted-foreground">· {u.file_name}</span></span>
                    <span className="text-xs text-muted-foreground tabular">
                      {u.period_start && `${dateLabel(u.period_start)} to ${dateLabel(u.period_end)} · `}{u.added_count} added, {u.duplicate_count} skipped
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-4 text-center text-sm text-muted-foreground">Nothing uploaded yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
