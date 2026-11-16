"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { CircleHelp, LayoutDashboard, ListOrdered, Settings, Upload } from "lucide-react";
import { useData, type Meta } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/questions", label: "Questions", icon: CircleHelp },
  { href: "/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, reload } = useData<Meta>("/api/meta");
  useEffect(() => {
    window.addEventListener("finance:changed", reload);
    return () => window.removeEventListener("finance:changed", reload);
  }, [reload]);
  const open = data?.open_questions || 0;

  const item = (n: (typeof NAV)[number], compact: boolean) => {
    const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center rounded-md text-sm font-medium transition-colors",
          compact ? "flex-1 flex-col gap-0.5 px-1 py-2 text-[11px]" : "gap-3 px-3 py-2",
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
        <span>{n.label}</span>
        {n.href === "/questions" && open > 0 && (
          <span
            className={cn(
              "rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular",
              compact ? "absolute right-2 top-0.5" : "ml-auto",
            )}
            aria-label={`${open} open questions`}
          >
            {open}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r bg-card p-3 md:flex">
        <div className="px-3 pb-4 pt-2 text-base font-semibold">Finance</div>
        {NAV.map((n) => item(n, false))}
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-card px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => item(n, true))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
