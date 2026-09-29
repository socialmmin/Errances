'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { fetchPackageDelivery, useSendPendingItinerary } from '@/hooks/use-whatsapp';
import { tr } from '@/i18n';

// Turns automatic WhatsApp delivery of one itinerary on or off. Turning it ON
// also offers to send it right away to every matching enquiry that hasn't
// received it yet -- flipping this switch alone used to leave the backlog
// unsent, which looked exactly like "I activated it but nothing went out".
export function ActiveSwitch({ pkg }: { pkg: { id: string; is_active: boolean; whatsapp_template_status?: string | null } }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sendPending = useSendPendingItinerary();
  const update = useMutation({
    mutationFn: (isActive: boolean) => api.patch(`/packages/${pkg.id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={pkg.is_active}
        disabled={update.isPending || sendPending.isPending}
        onCheckedChange={async (next) => {
          if (next && pkg.whatsapp_template_status !== 'APPROVED') { toast(tr("Meta must approve this itinerary’s template first (Edit → Stage 3)."), 'error'); return; }
          try {
            await update.mutateAsync(next);
            toast(next ? tr("Automatic sending is ON for this itinerary") : tr("Automatic sending is OFF for this itinerary"), 'success');
          } catch (error: any) {
            toast(error.message || tr("Could not update"), 'error');
            return;
          }
          if (!next) return;
          const status = await fetchPackageDelivery(pkg.id).catch(() => null);
          if (!status || status.pending <= 0) return;
          // No confirmation dialog here on purpose -- turning the switch on IS the
          // confirmation. Sends immediately to every matching enquiry not yet sent.
          try {
            const r = await sendPending.mutateAsync(pkg.id);
            toast(
              status.liveMode
                ? tr("Sent {sent}{value}", { sent: r.sent, value: r.failed ? `, ${r.failed} failed` : '' })
                : tr("Test mode is ON — sent {sent} to test numbers, {skippedTestMode} real numbers skipped. Turn off test mode in Settings to reach everyone.", { sent: r.sent, skippedTestMode: r.skippedTestMode }),
              r.failed ? 'error' : 'success',
            );
          } catch (error: any) {
            toast(error.message || tr("Could not send the backlog"), 'error');
          }
        }}
      />
      <span className={`text-xs font-semibold ${pkg.is_active ? 'text-emerald-700' : 'text-slate-500'}`}>{pkg.is_active ? tr("Active") : tr("Inactive")}</span>
    </div>
  );
}
