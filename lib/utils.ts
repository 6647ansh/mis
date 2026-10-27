import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names, letting later Tailwind classes override earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹ in Indian grouping; large values as Lakh / Crore (e.g. ₹1.49 Cr). */
export function formatINR(value: number, { compact = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  if (compact) {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  }
  return `₹${inrFormatter.format(value)}`;
}

export function formatNumber(value: number, digits = 0) {
  return Number.isFinite(value)
    ? value.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : '—';
}

/** "31 Oct 2026" from an ISO date or YYYY-MM-DD; empty input gives "—". */
export function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
