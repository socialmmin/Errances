'use client';

import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Lead } from '@/types/lead';
import { LOST_REASONS, QUALITY_STYLE } from '@/lib/lead-statuses';
import { tr } from '@/i18n';

const WHY: Record<string, string> = {
  status: 'from the status',
  manual: 'set by hand',
  invalid_or_missing_phone: 'no valid phone number',
  duplicate_phone: 'same number as an earlier lead',
  unanswered_followups: '3 unanswered follow-ups over 7 days',
};

// Good / Neutral / Bad, worked out automatically from the status and objective rules, with a manual override
// and the reason a lead was lost. Only Good outcomes are reported to Meta.
export function LeadQualityControl({ lead }: { lead: Lead }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const auto = !lead.quality_override;
  const q = lead.quality ? QUALITY_STYLE[lead.quality] : null;

  async function save(patch: { quality?: string | null; lostReason?: string | null }) {
    try {
      await api.patch(`/integrations/meta/lead-quality/${lead.id}`, { quality: patch.quality === undefined ? (lead.quality_override ?? null) : patch.quality, lostReason: patch.lostReason });
      qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast(tr("Saved"), 'success');
    } catch (error: any) { toast(error.message || tr("Could not save"), 'error'); }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gold/20 pt-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground">{tr("Lead quality")}{' '}{q && <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${q.chip}`}>{tr(q.label)}</span>}</p>
        <select value={lead.quality_override ?? ''} onChange={(e) => save({ quality: e.target.value || null })} className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">{tr("Automatic")}{auto && lead.quality_reason ? ` (${WHY[lead.quality_reason] ?? lead.quality_reason})` : ''}</option>
          <option value="GOOD">{tr("Good")}</option><option value="NEUTRAL">{tr("Neutral")}</option><option value="BAD">{tr("Bad")}</option>
        </select>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground">{tr("Reason (if lost or bad)")}</p>
        <select value={lead.lost_reason ?? ''} onChange={(e) => save({ lostReason: e.target.value })} className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">{tr("— none —")}</option>
          {LOST_REASONS.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
        </select>
      </div>
      <p className="text-[11px] text-muted-foreground">{tr("Only Good outcomes (Qualified, Quotation Sent, Advance Paid, Booked) are sent to Meta.")}</p>
    </div>
  );
}
