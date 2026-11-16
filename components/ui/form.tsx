import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "personal" | "business" | "warn" | "good" }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    personal: "bg-muted text-foreground",
    business: "bg-muted text-foreground",
    warn: "bg-muted text-foreground",
    good: "bg-muted text-foreground",
  };
  const dot = { neutral: "", personal: "bg-personal", business: "bg-business", warn: "bg-warning", good: "bg-good" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)} {...props}>
      {dot && <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />}
      {props.children}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: React.ReactNode }) {
  const border = tone === "error" ? "border-destructive" : tone === "success" ? "border-good" : "border-input";
  return <div className={cn("rounded-md border-l-4 bg-muted px-3 py-2 text-sm", border)} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
