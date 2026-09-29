'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { CampaignOption } from '@/hooks/use-leads';
import { tr } from '@/i18n';

// Compact, app-styled dropdown for the campaign filter -- the native <select>
// it replaces renders as a huge, plain, browser-styled list that doesn't
// match the rest of the CRM's UI.
export function CampaignFilterSelect({ value, onChange, campaigns }: {
  value: string; onChange: (value: string) => void; campaigns: CampaignOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = campaigns.filter((c) => !query.trim() || c.campaign_name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedLabel = value ? campaigns.find((c) => c.campaign_name === value)?.campaign_name ?? value : 'All campaigns';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 max-w-[14rem] items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm text-foreground"
      >
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-[60] max-h-80 w-[20rem] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="sticky top-0 border-b border-border bg-card p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr("Search campaigns…")}
                className="w-full rounded-lg border border-input bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-gold"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gold/10 ${!value ? 'font-semibold text-gold' : 'text-foreground'}`}
            >
              {tr("All campaigns")}
            </button>
            {filtered.map((c) => (
              <button
                key={c.campaign_name}
                type="button"
                onClick={() => { onChange(c.campaign_name); setOpen(false); setQuery(''); }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gold/10 ${value === c.campaign_name ? 'font-semibold text-gold' : 'text-foreground'}`}
              >
                <span className="min-w-0 flex-1 truncate">{c.campaign_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.lead_count}</span>
              </button>
            ))}
            {!filtered.length && <p className="px-3 py-4 text-center text-xs text-muted-foreground">{tr("No campaign matches.")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
