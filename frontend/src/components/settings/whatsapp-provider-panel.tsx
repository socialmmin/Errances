'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { tr } from '@/i18n';
import { useWhatsAppProviderActions, useWhatsAppProviders } from '@/hooks/use-whatsapp';

const WEBHOOK_URL = `${(process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '')}/integrations/meta/webhook`;

function Line({ ok, children }: { ok: boolean | 'warn'; children: React.ReactNode }) {
  const Icon = ok === true ? CheckCircle2 : ok === 'warn' ? AlertTriangle : XCircle;
  return <p className={`flex items-start gap-1.5 text-xs ${ok === true ? 'text-emerald-700' : ok === 'warn' ? 'text-amber-700' : 'font-semibold text-red-600'}`}><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{children}</span></p>;
}

// Settings > WhatsApp: the two ways WhatsApp can run (Twilio, or Meta's own Cloud API), which one
// is on, a live check of each, and the switch. Switching is refused by the server when the other
// side could not send or receive, so a click here can never silently stop WhatsApp.
export function WhatsAppProviderPanel() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const state = useWhatsAppProviders();
  const { switchTo, saveMeta } = useWhatsAppProviderActions();
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const d = state.data;

  async function change(provider: 'twilio' | 'meta') {
    const name = provider === 'meta' ? 'Meta' : 'Twilio';
    if (!(await confirm({ title: tr('Switch WhatsApp to {name}?', { name }), description: tr('From now on every WhatsApp message, template and bulk send goes through {name}. Bulk sends started on the other side are paused.', { name }), confirmLabel: tr('Switch to {name}', { name }) }))) return;
    try { await switchTo.mutateAsync(provider); toast(tr('WhatsApp now runs through {name}', { name }), 'success'); } catch (e: any) { toast(e.message || tr('Could not switch'), 'error'); }
  }

  async function save() {
    try {
      const saved = await saveMeta.mutateAsync({ phoneNumberId: phoneNumberId.trim() || d?.meta.phoneNumberId || '', businessAccountId: businessAccountId.trim() || d?.meta.businessAccountId || '', accessToken: accessToken.trim(), appSecret: appSecret.trim() || undefined });
      toast(tr('Meta connection saved for {number}', { number: saved.number }), 'success');
      setAccessToken(''); setAppSecret(''); setEditing(false);
    } catch (e: any) { toast(e.message || tr('Could not save'), 'error'); }
  }

  if (state.isLoading || !d) return <Card><CardContent className="p-5 text-sm text-muted-foreground">{state.isError ? (state.error as Error).message : tr('Checking Twilio and Meta…')}</CardContent></Card>;

  const badge = (on: boolean) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{on ? tr('On') : tr('Off')}</span>;
  const showForm = editing || !d.meta.configured;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{tr('WhatsApp runs through one of these at a time. The same number, inbox, bot, templates and bulk sends work with either.')}</p>
        <Button variant="outline" size="sm" disabled={state.isFetching} onClick={() => state.refetch()}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${state.isFetching ? 'animate-spin' : ''}`} />{tr('Check again')}</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className={d.active === 'twilio' ? 'border-emerald-400' : ''}>
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold">Twilio</p>{badge(d.active === 'twilio')}</div>
            {!d.twilio.configured ? <Line ok={false}>{tr('Twilio is not set up on the server.')}</Line> : (
              <>
                <p className="text-sm">{d.twilio.sender}{d.twilio.name ? ` · ${d.twilio.name}` : ''}</p>
                <Line ok={d.twilio.ready}>{d.twilio.ready ? tr('The Twilio sender is online.') : tr('The Twilio sender is not online ({status}).', { status: d.twilio.senderStatus ?? '—' })}</Line>
              </>
            )}
            {d.active !== 'twilio' && <Button variant="outline" className="mt-2" disabled={!d.twilio.ready || switchTo.isPending} onClick={() => change('twilio')}>{tr('Switch to {name}', { name: 'Twilio' })}</Button>}
          </CardContent>
        </Card>

        <Card className={d.active === 'meta' ? 'border-emerald-400' : ''}>
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold">{tr('Meta WhatsApp Cloud API')}</p>{badge(d.active === 'meta')}</div>
            {d.meta.configured && (
              <>
                <p className="text-sm">{d.meta.number ?? '—'}{d.meta.name ? ` · ${d.meta.name}` : ''}</p>
                <p className="text-xs text-muted-foreground">{tr('Phone Number ID')} {d.meta.phoneNumberId} · {tr('Business Account ID')} {d.meta.businessAccountId}{d.meta.dailyLimit ? ` · ${tr('{n} customers / 24 h', { n: d.meta.dailyLimit })}` : ''}{d.meta.quality ? ` · ${tr('quality')} ${d.meta.quality}` : ''}</p>
                {d.meta.ready ? <Line ok>{tr('Meta is ready: this app can send from the number and receives its messages.')}</Line> : d.meta.problems.map((p, i) => <Line key={i} ok={false}>{tr(p)}</Line>)}
                {d.meta.warnings.map((w, i) => <Line key={`w${i}`} ok="warn">{tr('Meta reports')}: {w}</Line>)}
              </>
            )}
            {showForm ? (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><Label>{tr('Phone Number ID')}</Label><Input className="mt-1" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder={d.meta.phoneNumberId ?? '1122537490948666'} /></div>
                  <div><Label>{tr('Business Account ID')}</Label><Input className="mt-1" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} placeholder={d.meta.businessAccountId ?? '1461053502615965'} /></div>
                </div>
                <div><Label>{tr('Access token')}</Label><Input className="mt-1" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAA…" autoComplete="off" /></div>
                <div><Label>{tr('App Secret')}{d.meta.hasAppSecret ? ` (${tr('saved — leave empty to keep it')})` : ''}</Label><Input className="mt-1" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="32 characters" autoComplete="off" /></div>
                <p className="text-[11px] text-muted-foreground">{tr('Each value is checked with Meta before it is saved. The token and secret are never shown again.')}</p>
                <div className="flex gap-2">
                  <Button variant="gold" disabled={!accessToken.trim() || saveMeta.isPending} onClick={save}>{saveMeta.isPending ? tr('Checking with Meta…') : tr('Save and check')}</Button>
                  {d.meta.configured && <Button variant="outline" onClick={() => setEditing(false)}>{tr('Cancel')}</Button>}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {d.active !== 'meta' && <Button variant="gold" disabled={!d.meta.ready || switchTo.isPending} onClick={() => change('meta')}>{tr('Switch to {name}', { name: 'Meta' })}</Button>}
                <Button variant="outline" onClick={() => setEditing(true)}>{tr('Change the Meta connection')}</Button>
              </div>
            )}
            {d.active !== 'meta' && d.meta.configured && !d.meta.ready && <p className="text-[11px] text-muted-foreground">{tr('The switch stays locked until Meta can really send and receive, so WhatsApp never stops by accident.')}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-sm font-semibold">{tr('Webhook address for the Meta app')}</p>
          <p className="break-all font-mono text-xs">{WEBHOOK_URL}</p>
          <p className="text-xs text-muted-foreground">{tr('In the Meta app: WhatsApp > Configuration > Callback URL, subscribed to "messages". The verify token is kept on the server.')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
