'use client';

import { Cake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { tr, locale } from '@/i18n';
import { useBirthdayActions, useBirthdays } from '@/hooks/use-broadcasts';

const STATUS: Record<string, string> = { APPROVED: 'Approved', PENDING: 'Waiting for WhatsApp', REJECTED: 'Rejected', PAUSED: 'Paused by WhatsApp', DISABLED: 'Disabled by WhatsApp' };

// Birthday greetings: on the customer's birthday (date of birth on the lead) WhatsApp sends a
// greeting from Errances Voyages, once a year, between 9:00 and 20:00 Paris time.
export function BirthdayCard() {
  const { toast } = useToast();
  const q = useBirthdays();
  const { toggle, submitTemplates } = useBirthdayActions();
  const d = q.data;
  if (!d) return null;
  const tpl = [d.templates.fr, d.templates.en];
  const anyApproved = tpl.some((t) => t?.status === 'APPROVED');
  const needSubmit = tpl.some((t) => !t || t.status === 'REJECTED');

  async function submit() {
    try { const r = await submitTemplates.mutateAsync(); toast(r.submitted.length ? tr('Birthday templates submitted to WhatsApp for approval') : tr('Nothing to submit'), 'success'); } catch (e: any) { toast(e.message || tr('Could not submit'), 'error'); }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Cake className="h-5 w-5 text-gold" /><div><p className="text-sm font-semibold">{tr('Birthday greetings')}</p><p className="text-xs text-muted-foreground">{tr('On a customer’s birthday, WhatsApp sends them a greeting from Errances Voyages (once a year, after 9:00 Paris time). Uses the date of birth saved on the lead.')}</p></div></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={d.enabled} onCheckedChange={(v: boolean) => toggle.mutate(v)} />{d.enabled ? tr('On') : tr('Off')}</label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(['fr', 'en'] as const).map((lang) => { const t = d.templates[lang]; return <span key={lang} className={`rounded-full px-2 py-0.5 font-semibold ${t?.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : t?.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{lang === 'fr' ? 'Français' : 'English'}: {t ? tr(STATUS[t.status] ?? t.status) : tr('not submitted')}</span>; })}
          {needSubmit && <Button size="sm" variant="outline" disabled={submitTemplates.isPending} onClick={submit}>{submitTemplates.isPending ? tr('Submitting…') : tr('Submit the birthday templates')}</Button>}
        </div>
        {!anyApproved && <p className="text-xs text-amber-700">{tr('Greetings start once WhatsApp approves a birthday template.')}</p>}
        {[d.templates.fr, d.templates.en].filter((t) => t?.status === 'REJECTED' && t.rejectionReason).map((t) => <p key={t!.name} className="text-xs font-semibold text-red-600">{t!.name}: {t!.rejectionReason}</p>)}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{tr('Birthdays in the next 7 days')}</p>
            {d.upcoming.length ? <ul className="mt-1 space-y-0.5 text-sm">{d.upcoming.map((u) => <li key={u.leadId}><a href={`/leads/${u.leadId}`} className="hover:underline">{u.name}</a> <span className="text-xs text-muted-foreground">· {u.inDays === 0 ? tr('today') : u.inDays === 1 ? tr('tomorrow') : tr('in {n} days', { n: u.inDays })}{u.hasWhatsApp ? '' : ` · ${tr('no WhatsApp number')}`}</span></li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">{tr('None.')}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{tr('Greetings sent')}</p>
            {d.recent.length ? <ul className="mt-1 space-y-0.5 text-sm">{d.recent.slice(0, 8).map((g, i) => <li key={i}>{g.customer_name || `+${g.phone}`} <span className={`text-xs ${g.status === 'failed' ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>· {new Date(g.created_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} · {tr(g.status === 'sent' ? 'Sent' : g.status === 'failed' ? 'Failed' : g.status)}{g.error ? ` (${g.error})` : ''}</span></li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">{tr('None yet.')}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
