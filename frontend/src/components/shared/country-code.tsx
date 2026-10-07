'use client';

import { PHONE_COUNTRIES } from '@/lib/utils';

// The country a phone number belongs to, beside the number box. The chosen one reads short
// ("FR +33") so it fits; the others are listed by name. Pair with phoneWithCountry().
export function CountryCode({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Country code"
      className="h-10 w-[5.75rem] shrink-0 rounded-lg border border-input bg-muted/50 px-1.5 text-xs font-semibold text-foreground">
      {PHONE_COUNTRIES.map((c) => <option key={c.iso} value={c.code}>{c.code === value ? `${c.iso} +${c.code}` : `${c.name} (+${c.code})`}</option>)}
    </select>
  );
}
