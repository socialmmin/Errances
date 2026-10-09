'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, Megaphone, Pause, Play, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { tr, locale } from '@/i18n';
import {
  BroadcastAudience, BroadcastRow, BroadcastVariable, SERVICE_TYPES, ServiceType, useBroadcast, useBroadcastActions, useBroadcastFilters, useBroadcastPreview, useBroadcasts, useBroadcastTemplates,
} from '@/hooks/use-broadcasts';
import { TemplateManager } from '@/components/broadcasts/template-manager';
import { TestSend } from '@/components/broadcasts/test-send';
import { PackagesSectionTabs } from '@/components/packages/section-tabs';

const selectBase = 'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground';
const selectClass = selectBase + ' w-full';
const money = (amount: number, currency: string) => new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(amount);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const label = (value: string) => tr(value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

const STATUS_STYLE: Record<string, string> = {
  sending: 'bg-blue-100 text-blue-800', waiting: 'bg-amber-100 text-amber-800', paused: 'bg-slate-200 text-slate-700',
  done: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-red-100 text-red-700',
};
const STATUS_LABEL: Record<string, string> = { sending: 'Sending', waiting: 'Waiting for daily limit', paused: 'Paused', done: 'Finished', cancelled: 'Cancelled' };
const RECIPIENT_LABEL: Record<string, string> = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', skipped: 'Skipped' };

function Chips({ options, value, onChange }: { options: { v: string; n: number }[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.v);
        return (
          <button key={o.v} type="button" onClick={() => onChange(on ? value.filter((x) => x !== o.v) : [...value, o.v])}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-navy bg-navy text-white' : 'border-border bg-white text-foreground hover:bg-muted'}`}>
            {label(o.v)} <span className={on ? 'text-white/70' : 'text-muted-foreground'}>{o.n}</span>
          </button>
        );
      })}
    </div>
  );
}

// Bulk WhatsApp: pick an approved template, choose who gets it, check the count and cost, send.
// Sending happens in the background a few messages per second; this page shows it progressing.
export default function BulkWhatsAppPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const templates = useBroadcastTemplates();
  const filters = useBroadcastFilters();
  const list = useBroadcasts();
  const { create, act } = useBroadcastActions();

  const [contentSid, setContentSid] = useState('');
  const [variables, setVariables] = useState<Record<string, BroadcastVariable>>({});
  const [audience, setAudience] = useState<BroadcastAudience>({});
  const [destination, setDestination] = useState('');
  const [name, setName] = useState('');
  // What the promo is about: a customer answering it is only asked the questions for that.
  const [service, setService] = useState<ServiceType | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);

  // The destination box filters as you pause typing, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setAudience((a) => ({ ...a, destination: destination.trim() || undefined })), 400);
    return () => clearTimeout(t);
  }, [destination]);

  // Only templates WhatsApp has approved can be sent; the rest are listed under Templates.
  const approved = useMemo(() => (templates.data ?? []).filter((t) => t.status === 'APPROVED'), [templates.data]);
  const template = useMemo(() => approved.find((t) => t.sid === contentSid) ?? null, [approved, contentSid]);
  const sendRef = useRef<HTMLDivElement>(null);
  const preview = useBroadcastPreview(audience, contentSid);
  const detail = useBroadcast(openId);

  function chooseTemplate(sid: string) {
    setContentSid(sid);
    const t = approved.find((x) => x.sid === sid);
    const next: Record<string, BroadcastVariable> = {};
    // The first variable in a message is nearly always the customer's name.
    for (const v of t?.variables ?? []) next[String(v.number)] = v.inBody && v.number === 1 ? { source: 'name' } : { source: 'text', value: v.inBody ? '' : v.sample };
    setVariables(next);
    setService(t?.service ?? '');
  }

  const filled = (template?.body ?? '').replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    const v = variables[n];
    if (!v) return `{{${n}}}`;
    // Same fallbacks the server uses when a lead has no real name or destination.
    const first = preview.data?.sample[0];
    if (v.source === 'name') return first ? (/\p{L}/u.test(first.name) ? first.name : 'there') : tr('Customer name');
    if (v.source === 'destination') return first ? (first.destination && !/to be confirmed/i.test(first.destination) ? first.destination : 'your next trip') : tr('Destination');
    return v.value || `{{${n}}}`;
  });
  const p = preview.data;
  const missingText = !!template && template.variables.some((v) => variables[String(v.number)]?.source === 'text' && !variables[String(v.number)]?.value?.trim());
  const overLimit = !!p && p.dailyLimit !== null && p.count > Math.max(Math.floor(p.dailyLimit * 0.9) - p.usedLast24h, 0);
  const lowBalance = !!p?.balance && p.balance.amount < p.estimate.total;
  const canSend = !!template && !!service && !!name.trim() && !!p?.count && !missingText && !create.isPending;

  async function send() {
    if (!template || !p) return;
    const ok = await confirm({
      title: tr('Send to {n} customers?', { n: p.count }),
      description: tr('"{template}" will be sent on WhatsApp to {n} numbers. Estimated cost {cost}. This cannot be undone once messages are delivered.', { template: template.name, n: p.count, cost: money(p.estimate.total, p.estimate.currency) }),
      confirmLabel: tr('Send now'),
    });
    if (!ok) return;
    try {
      const made = await create.mutateAsync({ name: name.trim(), contentSid, variables, audience, service: service as ServiceType });
      toast(tr('Bulk send started'), 'success');
      setName(''); setOpenId(made.id);
    } catch (e: any) { toast(e.message || tr('Could not start the bulk send'), 'error'); }
  }

  async function action(b: BroadcastRow, what: 'pause' | 'resume' | 'cancel') {
    if (what === 'cancel' && !(await confirm({ title: tr('Cancel "{name}"?', { name: b.name }), description: tr('Messages already sent stay sent. The {n} still waiting will not go out.', { n: b.queued }), confirmLabel: tr('Cancel bulk send'), variant: 'destructive' }))) return;
    try { await act.mutateAsync({ id: b.id, action: what }); } catch (e: any) { toast(e.message || tr('Could not update'), 'error'); }
  }

  return (
    <div className="space-y-5">
      <PackagesSectionTabs />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-navy dark:text-white"><Megaphone className="h-6 w-6 text-gold" />{tr('Bulk WhatsApp')}</h1>
        <p className="text-sm text-muted-foreground">{tr('Send one approved WhatsApp template to many leads at once. Customers who replied STOP are never included.')}</p>
      </div>

      {p && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('WhatsApp daily limit')}</p><p className="mt-1 text-xl font-bold">{p.dailyLimit === null ? tr('Unlimited') : tr('{n} customers / 24 h', { n: p.dailyLimit })}</p><p className="text-xs text-muted-foreground">{tr('{n} used in the last 24 hours', { n: p.usedLast24h })}</p></CardContent></Card>
          {p.provider === 'meta'
            ? <Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Billing')}</p><p className="mt-1 text-xl font-bold">Meta</p><p className="text-xs text-muted-foreground">{tr('Charged by Meta to the payment method on your WhatsApp account')}</p></CardContent></Card>
            : <Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Twilio balance')}</p><p className={`mt-1 text-xl font-bold ${lowBalance ? 'text-red-600' : ''}`}>{p.balance ? money(p.balance.amount, p.balance.currency) : '—'}</p><p className="text-xs text-muted-foreground">{tr('Top up in the Twilio console before a large send')}</p></CardContent></Card>}
          <Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Opted out (STOP)')}</p><p className="mt-1 text-xl font-bold">{p.optedOut}</p><p className="text-xs text-muted-foreground">{tr('Left out of every bulk send automatically')}</p></CardContent></Card>
        </div>
      )}

      <TemplateManager onUse={(sid) => { chooseTemplate(sid); sendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />

      <div ref={sendRef} className="-mb-5 scroll-mt-4" />
      <Card>
        <CardContent className="grid gap-6 p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label>{tr('1. Template')}</Label>
              <select className={`${selectClass} mt-1`} value={contentSid} onChange={(e) => chooseTemplate(e.target.value)}>
                <option value="">{templates.isLoading ? tr('Loading templates…') : tr('Choose an approved template')}</option>
                {approved.map((t) => <option key={t.sid} value={t.sid}>{t.name} · {label(t.category.toLowerCase())} · {t.language}</option>)}
              </select>
              {templates.isError && <p className="mt-1 text-xs font-semibold text-red-600">{(templates.error as Error).message}</p>}
              {!templates.isLoading && !approved.length && !templates.isError && <p className="mt-1 text-xs text-muted-foreground">{tr('No approved template yet. Templates are approved by WhatsApp before they can be sent in bulk.')}</p>}
            </div>

            {template && (
              <div>
                <Label>{tr('This promo is about')}</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SERVICE_TYPES.map((s) => (
                    <button key={s.value} type="button" onClick={() => setService(s.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${service === s.value ? 'border-navy bg-navy text-white' : 'border-border bg-white text-foreground hover:bg-muted'}`}>{tr(s.label)}</button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{tr('A customer who answers this promo is asked only the questions for it — e.g. no "family or friends?" for a ticket offer.')}</p>
              </div>
            )}

            {template && template.variables.length > 0 && (
              <div className="space-y-2">
                <Label>{tr('What goes in each blank')}</Label>
                {template.variables.map((v) => {
                  const key = String(v.number);
                  const cur = variables[key] ?? { source: 'text' as const, value: '' };
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-2">
                      <span className="w-12 shrink-0 rounded bg-slate-100 px-2 py-1 text-center font-mono text-xs">{`{{${v.number}}}`}</span>
                      <select className={`${selectBase} w-44 shrink-0`} value={cur.source} onChange={(e) => setVariables((all) => ({ ...all, [key]: { source: e.target.value as BroadcastVariable['source'], value: cur.value } }))}>
                        {v.inBody && <option value="name">{tr('Customer name')}</option>}
                        {v.inBody && <option value="destination">{tr('Destination')}</option>}
                        <option value="text">{tr('Same text for everyone')}</option>
                      </select>
                      {cur.source === 'text' && <Input className="min-w-[10rem] flex-1" value={cur.value ?? ''} placeholder={v.sample || tr('Text')} onChange={(e) => setVariables((all) => ({ ...all, [key]: { source: 'text', value: e.target.value } }))} />}
                      {!v.inBody && <p className="w-full pl-14 text-[11px] text-muted-foreground">{tr('This blank is part of a link or file address in the template.')}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <Label>{tr('2. Who receives it')}</Label>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">{tr('Lead status')} <span className="font-normal">({tr('none selected = everyone except lost, not interested, invalid and duplicate leads')})</span></p>
              <Chips options={filters.data?.statuses ?? []} value={audience.statuses ?? []} onChange={(v) => setAudience((a) => ({ ...a, statuses: v.length ? v : undefined }))} />
              {!!filters.data?.services?.length && <><p className="mt-3 text-xs font-semibold text-muted-foreground">{tr('Asked us for')}</p>
              <Chips options={filters.data.services} value={audience.services ?? []} onChange={(v) => setAudience((a) => ({ ...a, services: v.length ? v : undefined }))} /></>}
              <p className="mt-3 text-xs font-semibold text-muted-foreground">{tr('Lead source')}</p>
              <Chips options={filters.data?.sources ?? []} value={audience.sources ?? []} onChange={(v) => setAudience((a) => ({ ...a, sources: v.length ? v : undefined }))} />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold text-muted-foreground">{tr('Destination contains')}</p><Input className="mt-1" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={tr('e.g. Bali')} /></div>
                <div><p className="text-xs font-semibold text-muted-foreground">{tr('Assigned to')}</p>
                  <select className={`${selectClass} mt-1`} value={audience.assignedTo?.[0] ?? ''} onChange={(e) => setAudience((a) => ({ ...a, assignedTo: e.target.value ? [e.target.value] : undefined }))}>
                    <option value="">{tr('Anyone')}</option>
                    {(filters.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select></div>
                <div><p className="text-xs font-semibold text-muted-foreground">{tr('Lead created from')}</p><Input className="mt-1" type="date" value={audience.createdFrom ?? ''} onChange={(e) => setAudience((a) => ({ ...a, createdFrom: e.target.value || undefined }))} /></div>
                <div><p className="text-xs font-semibold text-muted-foreground">{tr('Lead created until')}</p><Input className="mt-1" type="date" value={audience.createdTo ?? ''} onChange={(e) => setAudience((a) => ({ ...a, createdTo: e.target.value || undefined }))} /></div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!audience.onlyChatted} onChange={(e) => setAudience((a) => ({ ...a, onlyChatted: e.target.checked || undefined }))} />{tr('Only customers who have messaged us on WhatsApp')}</label>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>{tr('Message preview')}</Label>
              <div className="mt-1 rounded-xl bg-[#e5ddd5] p-4">
                <div className="max-w-sm rounded-lg bg-white p-3 text-sm shadow-sm">
                  {template?.hasMedia && <div className="mb-2 rounded bg-slate-100 px-3 py-4 text-center text-xs text-muted-foreground">{tr('Image or document')}</div>}
                  <p className="whitespace-pre-wrap break-words">{template ? filled : tr('Choose a template to see the message.')}</p>
                  {template?.footer && <p className="mt-1 text-xs text-muted-foreground">{template.footer}</p>}
                  {!!template?.buttons.length && <div className="mt-2 space-y-1 border-t pt-2">{template.buttons.map((b, i) => <p key={i} className="text-center text-sm font-medium text-sky-600">{b}</p>)}</div>}
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/40 p-4">
              <Label>{tr('3. Check and send')}</Label>
              {preview.isLoading || !p ? <p className="mt-2 text-sm text-muted-foreground">{tr('Counting…')}</p> : (
                <>
                  <p className="mt-2 text-3xl font-bold text-navy dark:text-white">{p.count} <span className="text-base font-medium text-muted-foreground">{tr('customers will receive it')}</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{tr('{matched} leads match · {dup} share a number · {invalid} have no valid number · {stop} replied STOP', { matched: p.matched, dup: p.duplicates, invalid: p.invalid, stop: p.optedOut })}</p>
                  <p className="mt-2 text-sm">{tr('Estimated cost')}: <span className="font-semibold">{money(p.estimate.total, p.estimate.currency)}</span> <span className="text-xs text-muted-foreground">({p.provider === 'meta' ? tr('approximate — WhatsApp fee for a {category} template', { category: label(p.estimate.category.toLowerCase()) }) : tr('approximate — WhatsApp and Twilio fees for a {category} template', { category: label(p.estimate.category.toLowerCase()) })})</span></p>
                  {lowBalance && <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{tr('The Twilio balance is lower than the estimated cost. Top up first or messages will start failing part-way.')}</p>}
                  {overLimit && <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{tr('This is more than WhatsApp allows in 24 hours. The rest will wait and go out automatically as the limit frees up, over the following days.')}</p>}
                  {!!p.sample.length && <p className="mt-2 text-xs text-muted-foreground">{tr('For example')}: {p.sample.slice(0, 5).map((s) => s.name || `+${s.phone}`).join(', ')}{p.count > 5 ? '…' : ''}</p>}
                </>
              )}
              <div className="mt-3"><TestSend contentSid={contentSid} variables={variables} service={service || undefined} ready={!!template && !missingText} /></div>
              <div className="mt-3"><p className="text-xs font-semibold text-muted-foreground">{tr('Name for this bulk send (only you see it)')}</p><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Summer offer - June')} maxLength={80} /></div>
              {missingText && <p className="mt-2 text-xs font-semibold text-red-600">{tr('Fill in every blank of the template first.')}</p>}
              <Button variant="gold" className="mt-3 w-full" disabled={!canSend} onClick={send}><Send className="mr-2 h-4 w-4" />{create.isPending ? tr('Starting…') : tr('Send to {n} customers', { n: p?.count ?? 0 })}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold">{tr('Bulk sends')}</p>
          {!list.data?.length ? <p className="mt-3 text-sm text-muted-foreground">{list.isLoading ? tr('Loading…') : tr('Nothing sent in bulk yet.')}</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{tr('Name')}</th><th className="py-2 pr-3">{tr('Status')}</th><th className="py-2 pr-3">{tr('Progress')}</th><th className="py-2 pr-3">{tr('Delivered')}</th><th className="py-2 pr-3">{tr('Read')}</th><th className="py-2 pr-3">{tr('Failed')}</th><th className="py-2 pr-3">{tr('Started')}</th><th className="py-2" />
                </tr></thead>
                <tbody>
                  {list.data.map((b) => {
                    const done = b.total - b.queued;
                    return (
                      <tr key={b.id} className={`cursor-pointer border-b last:border-0 hover:bg-muted/50 ${openId === b.id ? 'bg-muted/60' : ''}`} onClick={() => setOpenId(openId === b.id ? null : b.id)}>
                        <td className="py-2 pr-3"><p className="font-medium">{b.name}</p><p className="text-xs text-muted-foreground">{b.template_name}{b.created_by_name ? ` · ${b.created_by_name}` : ''}</p></td>
                        <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[b.status] ?? ''}`}>{tr(STATUS_LABEL[b.status] ?? b.status)}</span></td>
                        <td className="py-2 pr-3"><div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-navy" style={{ width: `${b.total ? Math.round((done / b.total) * 100) : 0}%` }} /></div><p className="mt-0.5 text-xs text-muted-foreground">{done} / {b.total}</p></td>
                        <td className="py-2 pr-3">{b.delivered}</td>
                        <td className="py-2 pr-3"><span className="inline-flex items-center gap-1">{b.read}{b.read > 0 && <CheckCheck className="h-3.5 w-3.5 text-sky-500" />}</span></td>
                        <td className={`py-2 pr-3 ${b.failed ? 'font-semibold text-red-600' : ''}`}>{b.failed}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{when(b.created_at)}</td>
                        <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {(b.status === 'sending' || b.status === 'waiting') && <Button size="sm" variant="outline" className="mr-1" onClick={() => action(b, 'pause')}><Pause className="mr-1 h-3.5 w-3.5" />{tr('Pause')}</Button>}
                          {b.status === 'paused' && <Button size="sm" variant="outline" className="mr-1" onClick={() => action(b, 'resume')}><Play className="mr-1 h-3.5 w-3.5" />{tr('Resume')}</Button>}
                          {['sending', 'waiting', 'paused'].includes(b.status) && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => action(b, 'cancel')}><X className="mr-1 h-3.5 w-3.5" />{tr('Cancel')}</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {openId && detail.data && (
            <div className="mt-4 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{detail.data.name}</p><p className="text-xs text-muted-foreground">{tr('{sent} sent · {delivered} delivered · {read} read · {failed} failed · {skipped} skipped · {queued} waiting', { sent: detail.data.sent, delivered: detail.data.delivered, read: detail.data.read, failed: detail.data.failed, skipped: detail.data.skipped, queued: detail.data.queued })}</p></div>
                <button type="button" onClick={() => setOpenId(null)} className="rounded p-1 hover:bg-muted" aria-label={tr('Close')}><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-3 max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-1.5 pr-3">{tr('Customer')}</th><th className="py-1.5 pr-3">{tr('Number')}</th><th className="py-1.5 pr-3">{tr('Status')}</th><th className="py-1.5">{tr('Reason')}</th></tr></thead>
                  <tbody>
                    {detail.data.recipients.map((r) => (
                      <tr key={r.phone} className="border-b last:border-0">
                        <td className="py-1.5 pr-3">{r.lead_id ? <a className="text-navy underline-offset-2 hover:underline dark:text-gold" href={`/whatsapp?lead=${r.lead_id}`}>{r.name || '—'}</a> : (r.name || '—')}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">+{r.phone}</td>
                        <td className={`py-1.5 pr-3 ${r.status === 'failed' ? 'font-semibold text-red-600' : r.status === 'read' ? 'text-sky-600' : ''}`}>{tr(RECIPIENT_LABEL[r.status] ?? r.status)}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">{r.error ? tr(r.error) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
