'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shuffle, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

type Person = { id: string; full_name: string; phone: string | null; role_name: string; participate_round_robin: boolean; assigned_leads: number };
type Preview = { unassigned: number; total: number; people: Person[] };

export function useLeadDistribution(enabled = true) {
  return useQuery({ queryKey: ['lead-distribution'], queryFn: () => api.get<Preview>('/users/lead-distribution'), enabled });
}

// Splits every unassigned lead evenly, oldest first, in rotation across the people ticked here.
// Shows the exact split before anything changes; only runs on "Distribute".
export function DistributeLeadsDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useLeadDistribution();
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { if (data) setPicked(data.people.filter((p) => p.participate_round_robin).map((p) => p.id)); }, [data]);
  const run = useMutation({
    mutationFn: (userIds: string[]) => api.post<{ assigned: number; perUser: Record<string, number> }>('/users/lead-distribution', { userIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lead-distribution'] }); qc.invalidateQueries({ queryKey: ['settings-users'] }); qc.invalidateQueries({ queryKey: ['leads'] }); },
  });

  const n = picked.length;
  const unassigned = data?.unassigned ?? 0;
  // Same rule as the server: oldest first in rotation, so the first (unassigned % n) people get one extra.
  const shareFor = useMemo(() => {
    const order = (data?.people ?? []).filter((p) => picked.includes(p.id)).map((p) => p.id);
    const base = n ? Math.floor(unassigned / n) : 0;
    const extra = n ? unassigned % n : 0;
    return (id: string) => { const i = order.indexOf(id); return i < 0 ? 0 : base + (i < extra ? 1 : 0); };
  }, [data, picked, n, unassigned]);

  async function go() {
    try {
      const r = await run.mutateAsync((data?.people ?? []).filter((p) => picked.includes(p.id)).map((p) => p.id));
      toast(`${r.assigned} leads assigned in rotation`, 'success');
      onClose();
    } catch (e: any) { toast(e.message || 'Could not distribute leads', 'error'); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9990] grid place-items-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-navy-900">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy dark:text-white"><Shuffle className="h-5 w-5 text-gold" />Distribute leads (round robin)</h2>
            <p className="text-sm text-muted-foreground">{isLoading ? 'Counting…' : `${unassigned} of ${data?.total ?? 0} leads have nobody handling them.`}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/5"><th className="px-5 py-2">Include</th><th className="px-3 py-2">Person</th><th className="px-3 py-2 text-right">Has now</th><th className="px-5 py-2 text-right">Will get</th></tr></thead>
          <tbody>
            {(data?.people ?? []).map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-5 py-2.5"><input type="checkbox" className="h-4 w-4 accent-gold" checked={picked.includes(p.id)} onChange={(e) => setPicked((l) => e.target.checked ? [...l, p.id] : l.filter((x) => x !== p.id))} aria-label={`Include ${p.full_name}`} /></td>
                <td className="px-3 py-2.5"><p className="font-medium text-navy dark:text-white">{p.full_name}</p><p className="text-[11px] capitalize text-muted-foreground">{p.role_name.replace(/_/g, ' ')}{!p.participate_round_robin ? ' · round robin off' : ''}</p></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{p.assigned_leads}</td>
                <td className="px-5 py-2.5 text-right font-bold tabular-nums text-emerald-700">{picked.includes(p.id) ? `+${shareFor(p.id)}` : '—'}</td>
              </tr>
            ))}
            {!isLoading && !(data?.people ?? []).length && <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-muted-foreground">No active salespeople yet. Add employees first.</td></tr>}
          </tbody>
        </table>
        <p className="px-5 pt-3 text-xs text-muted-foreground">Oldest leads first, one each in turn, so everyone gets an even share. New leads keep rotating automatically between people with round robin on.</p>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!n || !unassigned || run.isPending} onClick={go}>{run.isPending ? 'Distributing…' : `Distribute ${unassigned} leads to ${n} ${n === 1 ? 'person' : 'people'}`}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
