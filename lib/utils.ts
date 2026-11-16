import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rupees with Indian digit grouping (lakhs and crores). */
export const formatINR = (n: number, exact = false) => (exact ? inrExact : inr).format(n || 0);

/** Short axis labels: 1.2L, 45K. */
export function compactINR(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`;
  return `₹${n.toFixed(0)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function dateLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
