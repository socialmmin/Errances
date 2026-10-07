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

// A phone number as WhatsApp wants it (country code + number, digits only), or null if it is not
// one. Same rule as the server's waNumber: Indian mobiles get 91, a 10-digit number starting with
// 0 is French (06 12 34 56 78 -> 33612345678), anything else must carry its country code.
export function waNumber(raw?: string | null): string | null {
  let d = String(raw || '').replace(/\D/g, '');
  const local = d.replace(/^(91|0)(?=\d{10}$)/, '');
  if (/^[6-9]\d{9}$/.test(local)) return `91${local}`;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = `33${d.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}
