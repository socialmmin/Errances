import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Money is stored as integer minor units (e.g. paise) in the backend.
export function formatMoney(minorUnits: number | string | null | undefined, currency = 'INR') {
  const value = Number(minorUnits ?? 0) / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value);
}

// Indian numbers show as the plain 10-digit mobile (no +91 / 91 / 0 prefix);
// anything else is kept as an international number with its +.
export function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.replace(/^(91|0)(?=\d{10}$)/, '');
  if (/^[6-9]\d{9}$/.test(local)) return local;
  return `+${digits}`;
}
