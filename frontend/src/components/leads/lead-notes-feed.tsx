'use client';

import { useState } from 'react';
import { ClipboardList, FileText, CalendarClock, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useCreateLeadNote, useLeadNotesFeed } from '@/hooks/use-lead-notes';

const SOURCE_ICON = { note: StickyNote, requirement: ClipboardList, quotation: FileText, followup: CalendarClock } as const;
const SOURCE_STYLE = {
  note: 'bg-gold/15 text-gold', requirement: 'bg-sky-100 text-sky-700',
  quotation: 'bg-emerald-100 text-emerald-700', followup: 'bg-indigo-100 text-indigo-700',
} as const;

// One combined timeline for a lead: whatever's typed here directly, plus a
// read-only mirror of the notes already recorded on its requirements,
// quotations and follow-ups -- so nothing typed anywhere for this lead is
// invisible from one place. Shows the most recent 10; older freeform notes
// past #10 are pruned server-side once they're 45+ days old.
export function LeadNotesFeed({ leadId }: { leadId: string }) {
  const { toast } = useToast();
  const { data, isLoading } = useLeadNotesFeed(leadId);
  const createNote = useCreateLeadNote(leadId);
  const [draft, setDraft] = useState('');

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    try {
      await createNote.mutateAsync(body);
      setDraft('');
    } catch (error: any) {
      toast(error.message || 'Could not save the note', 'error');
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a note about this lead…"
          className="min-h-24 w-full rounded-xl border border-border bg-background p-4 text-sm focus:border-gold focus:outline-none"
        />
        <Button variant="gold" className="mt-2 gap-2" disabled={!draft.trim() || createNote.isPending} onClick={submit}>
          {createNote.isPending ? 'Saving…' : 'Add note'}
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Recent activity (last {10})</h3>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : !data?.data.length ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No notes yet — from here, requirements, quotations or follow-ups.</p>
          : <div className="space-y-2">
            {data.data.map((item) => {
              const Icon = SOURCE_ICON[item.source];
              return (
                <div key={item.id} className="flex gap-3 rounded-xl border border-border bg-background p-3">
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${SOURCE_STYLE[item.source]}`}><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-1"><span className="text-xs font-semibold text-navy dark:text-gold">{item.label}</span><span className="text-[11px] text-muted-foreground">{new Date(item.at).toLocaleString('en-IN')}{item.by ? ` · ${item.by}` : ''}</span></div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>}
      </div>
    </section>
  );
}
