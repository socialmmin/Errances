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

// Country calling codes offered when a phone number is typed in, France first (an agency in Paris).
export const PHONE_COUNTRIES: { iso: string; code: string; name: string; example: string }[] = [
  { iso: 'FR', code: '33', name: 'France', example: '6 12 34 56 78' },
  { iso: 'BE', code: '32', name: 'Belgium', example: '470 12 34 56' },
  { iso: 'CH', code: '41', name: 'Switzerland', example: '78 123 45 67' },
  { iso: 'LU', code: '352', name: 'Luxembourg', example: '621 123 456' },
  { iso: 'GB', code: '44', name: 'United Kingdom', example: '7400 123456' },
  { iso: 'DE', code: '49', name: 'Germany', example: '1512 3456789' },
  { iso: 'ES', code: '34', name: 'Spain', example: '612 34 56 78' },
  { iso: 'IT', code: '39', name: 'Italy', example: '312 345 6789' },
  { iso: 'PT', code: '351', name: 'Portugal', example: '912 345 678' },
  { iso: 'NL', code: '31', name: 'Netherlands', example: '6 12345678' },
  { iso: 'MA', code: '212', name: 'Morocco', example: '612 345678' },
  { iso: 'DZ', code: '213', name: 'Algeria', example: '551 23 45 67' },
  { iso: 'TN', code: '216', name: 'Tunisia', example: '20 123 456' },
  { iso: 'US', code: '1', name: 'USA / Canada', example: '201 555 0123' },
  { iso: 'AE', code: '971', name: 'UAE', example: '50 123 4567' },
  { iso: 'IN', code: '91', name: 'India', example: '98430 12345' },
  { iso: 'LK', code: '94', name: 'Sri Lanka', example: '71 234 5678' },
];

// The number as typed next to a chosen country, in full international form (+33612345678), or
// null if it cannot be a phone number. A number typed with its own + or 00 prefix keeps that
// country code; otherwise the leading 0 people write inside their country (06 12...) is dropped.
export function phoneWithCountry(countryCode: string, raw: string): string | null {
  const typed = String(raw || '').trim();
  let digits = typed.replace(/\D/g, '');
  if (!digits) return null;
  if (typed.startsWith('+')) { /* already international */ }
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else digits = countryCode + digits.replace(/^0+/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
