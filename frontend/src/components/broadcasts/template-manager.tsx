'use client';

import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, FileText, Plus, Trash2, Upload, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { tr, locale } from '@/i18n';
import { uploadPackageDocument } from '@/hooks/use-packages';
import { BroadcastTemplate, NewTemplateInput, SERVICE_TYPES, ServiceType, useBroadcastTemplates, useTemplateActions } from '@/hooks/use-broadcasts';

const selectBase = 'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground';
const selectClass = selectBase + ' w-full';
const STATUS: Record<string, { label: string; style: string; icon: typeof Clock }> = {
  APPROVED: { label: 'Approved', style: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  PENDING: { label: 'Waiting for WhatsApp', style: 'bg-amber-100 text-amber-800', icon: Clock },
  REJECTED: { label: 'Rejected', style: 'bg-red-100 text-red-700', icon: XCircle },
  PAUSED: { label: 'Paused by WhatsApp', style: 'bg-slate-200 text-slate-700', icon: Clock },
  DISABLED: { label: 'Disabled by WhatsApp', style: 'bg-slate-200 text-slate-700', icon: XCircle },
};
const ORDER: Record<string, number> = { PENDING: 0, REJECTED: 1, PAUSED: 2, DISABLED: 3, APPROVED: 4 };
type ButtonDraft = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone?: string };
const blanksIn = (body: string) => [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

// Templates on the Bulk WhatsApp page: every template with WhatsApp's decision on it (refreshed
// by itself while one is waiting), and a form to write a new one and submit it for approval.
export function TemplateManager({ onUse }: { onUse: (sid: string) => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const templates = useBroadcastTemplates();
  const { create, remove, setService } = useTemplateActions();
  const [open, setOpen] = useState(false);
  const [showApproved, setShowApproved] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [service, setServiceChoice] = useState<ServiceType | ''>('');
  const [language, setLanguage] = useState<'en' | 'fr'>('fr');
  const [body, setBody] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [header, setHeader] = useState<{ objectKey: string; fileName: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => [...(templates.data ?? [])].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.name.localeCompare(b.name)), [templates.data]);
  const inReview = all.filter((t) => t.status !== 'APPROVED');
  const approved = all.filter((t) => t.status === 'APPROVED');
  const blanks = blanksIn(body);
  const slug = name.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const problem = !slug ? 'Give the template a name'
    : !body.trim() ? 'Write the message text'
    : blanks.some((n, i) => n !== i + 1) ? 'Number the blanks in order: {{1}}, {{2}}, {{3}}...'
    : /^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*$/.test(body) ? 'The message cannot start or end with a blank -- add some words around it'
    : blanks.some((n) => !samples[n - 1]?.trim()) ? 'Give an example for every blank'
    : buttons.some((b) => !b.text.trim() || (b.type === 'URL' && !/^https:\/\/\S+\.\S+$/.test(b.url?.trim() ?? '')) || (b.type === 'PHONE_NUMBER' && !b.phone?.trim())) ? 'Complete every button (text, and its link or number)'
    : '';
  const filled = body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => samples[Number(n) - 1]?.trim() || m);

  function reset() {
    setName(''); setCategory('MARKETING'); setServiceChoice(''); setLanguage('fr'); setBody(''); setSamples([]); setFooter(''); setButtons([]); setHeader(null);
  }

  function addBlank() {
    const el = bodyRef.current;
    const next = `{{${(blanks[blanks.length - 1] ?? 0) + 1}}}`;
    const at = el ? el.selectionStart : body.length;
    setBody(body.slice(0, at) + next + body.slice(el ? el.selectionEnd : at));
    setTimeout(() => { el?.focus(); el?.setSelectionRange(at + next.length, at + next.length); }, 0);
  }

  async function pickFile(file?: File) {
    if (!file) return;
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) { toast(tr('Choose a JPG or PNG image, or a PDF'), 'error'); return; }
    setUploading(true);
    try {
      const { objectKey } = await uploadPackageDocument(file, 'whatsapp-template-samples');
      setHeader({ objectKey, fileName: file.name });
    } catch (e: any) { toast(e.message || tr('Upload failed'), 'error'); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function submit() {
    const input: NewTemplateInput = {
      name: slug, category, language, service: service || undefined, body: body.trim(), samples: blanks.map((n) => samples[n - 1].trim()), footer: footer.trim() || undefined,
      buttons: buttons.map((b) => ({ type: b.type, text: b.text.trim(), url: b.url?.trim(), phone: b.phone?.trim() })),
      headerObjectKey: header?.objectKey, headerFileName: header?.fileName,
    };
    try {
      await create.mutateAsync(input);
      toast(tr('Template submitted to WhatsApp for approval'), 'success');
      reset(); setOpen(false);
    } catch (e: any) { toast(e.message || tr('Could not submit the template'), 'error'); }
  }

  async function del(t: BroadcastTemplate) {
    if (!(await confirm({ title: tr('Delete "{name}"?', { name: t.name }), description: tr('The template is removed from WhatsApp and can no longer be sent.'), confirmLabel: tr('Delete'), variant: 'destructive' }))) return;
    try { await remove.mutateAsync(t.sid); toast(tr('Template deleted'), 'success'); } catch (e: any) { toast(e.message || tr('Could not delete'), 'error'); }
  }

  const row = (t: BroadcastTemplate) => {
    const s = STATUS[t.status] ?? STATUS.PENDING;
    const Icon = s.icon;
    return (
      <div key={t.sid} className="flex flex-wrap items-start gap-3 border-b py-2.5 last:border-0">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium">{t.name} <span className="ml-1 text-xs font-normal text-muted-foreground">{tr(t.category === 'UTILITY' ? 'Utility' : 'Marketing')}{t.service ? ` · ${tr(SERVICE_TYPES.find((x) => x.value === t.service)?.label ?? '')}` : ''} · {t.language}{t.hasMedia ? ` · ${tr('with file')}` : ''}</span></p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
          {t.status === 'REJECTED' && <p className="mt-1 text-xs font-semibold text-red-600">{tr('WhatsApp said')}: {t.rejectionReason || tr('no reason given')}</p>}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${s.style}`}><Icon className="h-3 w-3" />{tr(s.label)}</span>
        <div className="flex shrink-0 items-center gap-1">
          <select aria-label={tr('This promo is about')} title={tr('This promo is about')} value={t.service ?? ''} onChange={(e) => e.target.value && setService.mutate({ templateName: t.name, service: e.target.value as ServiceType })} className="h-8 rounded-md border border-input bg-background px-1.5 text-xs">
            <option value="">{tr('About…')}</option>
            {SERVICE_TYPES.map((s) => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
          </select>
          {t.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => onUse(t.sid)}>{tr('Use')}</Button>}
          {t.createdHere && <button type="button" onClick={() => del(t)} title={tr('Delete')} aria-label={tr('Delete')} className="rounded p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{tr('Templates')}</p>
            <p className="text-xs text-muted-foreground">{tr('WhatsApp must approve a template before it can be sent. Approval usually takes a few minutes, sometimes up to a day; this list updates by itself.')}</p>
          </div>
          {!open && <Button variant="gold" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />{tr('New template')}</Button>}
        </div>

        {open && (
          <div className="mt-4 grid gap-6 rounded-xl border bg-muted/30 p-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3"><Label>{tr('Template name')}</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Summer offer Bali')} maxLength={60} />{slug && <p className="mt-1 text-[11px] text-muted-foreground">{tr('Saved as')}: <span className="font-mono">{slug}</span></p>}</div>
                <div className="sm:col-span-2"><Label>{tr('Kind of message')}</Label>
                  <select className={`${selectClass} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')}>
                    <option value="MARKETING">{tr('Marketing (offers, news, invitations)')}</option>
                    <option value="UTILITY">{tr('Utility (about a booking or request they made)')}</option>
                  </select></div>
                <div><Label>{tr('Language')}</Label>
                  <select className={`${selectClass} mt-1`} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'fr')}>
                    <option value="fr">Français</option><option value="en">English</option>
                  </select></div>
                <div className="sm:col-span-3"><Label>{tr('This promo is about')}</Label>
                  <select className={`${selectClass} mt-1`} value={service} onChange={(e) => setServiceChoice(e.target.value as ServiceType | '')}>
                    <option value="">{tr('Decide when sending')}</option>
                    {SERVICE_TYPES.map((s) => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
                  </select></div>
              </div>

              <div>
                <Label>{tr('Image or PDF above the message (optional)')}</Label>
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
                {header
                  ? <div className="mt-1 flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm"><FileText className="h-4 w-4 text-gold" /><span className="min-w-0 flex-1 truncate">{header.fileName}</span><button type="button" onClick={() => setHeader(null)} aria-label={tr('Remove')} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button></div>
                  : <Button type="button" variant="outline" className="mt-1" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{uploading ? tr('Uploading…') : tr('Choose a file')}</Button>}
              </div>

              <div>
                <div className="flex items-center justify-between"><Label>{tr('Message text')}</Label><button type="button" onClick={addBlank} className="text-xs font-semibold text-navy underline-offset-2 hover:underline dark:text-gold">+ {tr('Add a blank (name, destination…)')}</button></div>
                <Textarea ref={bodyRef} className="mt-1 min-h-[9rem]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} placeholder={tr('Bonjour {{1}}, découvrez notre nouvelle offre pour {{2}}…')} />
                <p className="mt-1 text-[11px] text-muted-foreground">{body.length} / 1024 · {tr('*bold*  _italic_  — a blank like {{1}} is filled in for each customer')}</p>
              </div>

              {blanks.length > 0 && (
                <div>
                  <Label>{tr('An example for each blank (WhatsApp reviews these)')}</Label>
                  <div className="mt-1 space-y-2">
                    {blanks.map((n) => (
                      <div key={n} className="flex items-center gap-2"><span className="w-12 shrink-0 rounded bg-slate-100 px-2 py-1 text-center font-mono text-xs">{`{{${n}}}`}</span><Input value={samples[n - 1] ?? ''} placeholder={n === 1 ? 'Claire' : 'Bali'} onChange={(e) => setSamples((s) => { const next = [...s]; next[n - 1] = e.target.value; return next; })} /></div>
                    ))}
                  </div>
                </div>
              )}

              <div><Label>{tr('Small line under the message (optional)')}</Label><Input className="mt-1" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} placeholder={tr('e.g. Reply STOP to unsubscribe')} /></div>

              <div>
                <Label>{tr('Buttons (optional, up to 3)')}</Label>
                <div className="mt-1 space-y-2">
                  {buttons.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select className={`${selectBase} w-36 shrink-0`} value={b.type} onChange={(e) => setButtons((list) => list.map((x, k) => (k === i ? { ...x, type: e.target.value as ButtonDraft['type'] } : x)))}>
                        <option value="QUICK_REPLY">{tr('Quick reply')}</option><option value="URL">{tr('Website link')}</option><option value="PHONE_NUMBER">{tr('Call us')}</option>
                      </select>
                      <Input className="w-40" value={b.text} maxLength={25} placeholder={tr('Button text')} onChange={(e) => setButtons((list) => list.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
                      {b.type === 'URL' && <Input className="min-w-[10rem] flex-1" value={b.url ?? ''} placeholder="https://…" onChange={(e) => setButtons((list) => list.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />}
                      {b.type === 'PHONE_NUMBER' && <Input className="min-w-[10rem] flex-1" value={b.phone ?? ''} inputMode="tel" placeholder="+33 1 23 45 67 89" onChange={(e) => setButtons((list) => list.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} />}
                      <button type="button" onClick={() => setButtons((list) => list.filter((_, k) => k !== i))} aria-label={tr('Remove')} className="rounded p-1.5 text-red-500 hover:bg-red-50"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                  {buttons.length < 3 && <Button type="button" size="sm" variant="outline" onClick={() => setButtons((list) => [...list, { type: 'QUICK_REPLY', text: '' }])}><Plus className="mr-1 h-3.5 w-3.5" />{tr('Add a button')}</Button>}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>{tr('How the customer sees it')}</Label>
                <div className="mt-1 rounded-xl bg-[#e5ddd5] p-4">
                  <div className="max-w-sm rounded-lg bg-white p-3 text-sm shadow-sm">
                    {header && <div className="mb-2 flex items-center gap-2 rounded bg-slate-100 px-3 py-3 text-xs text-muted-foreground"><FileText className="h-4 w-4" /><span className="truncate">{header.fileName}</span></div>}
                    <p className="whitespace-pre-wrap break-words">{filled || tr('Your message appears here.')}</p>
                    {footer.trim() && <p className="mt-1 text-xs text-muted-foreground">{footer}</p>}
                    {buttons.some((b) => b.text.trim()) && <div className="mt-2 space-y-1 border-t pt-2">{buttons.filter((b) => b.text.trim()).map((b, i) => <p key={i} className="text-center text-sm font-medium text-sky-600">{b.text}</p>)}</div>}
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">{tr('To get approved quickly')}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>{tr('Say who you are (Errances Voyages) and why you are writing.')}</li>
                  <li>{tr('Marketing is for offers; Utility only for something the customer asked for or booked.')}</li>
                  <li>{tr('No blank at the very start or end, and real-looking examples.')}</li>
                </ul>
              </div>
              {problem && (name || body) && <p className="text-xs font-semibold text-amber-700">{tr(problem)}</p>}
              <div className="flex gap-2">
                <Button variant="gold" className="flex-1" disabled={!!problem || uploading || create.isPending} onClick={submit}>{create.isPending ? tr('Submitting…') : tr('Submit to WhatsApp for approval')}</Button>
                <Button variant="outline" onClick={() => { setOpen(false); }}>{tr('Close')}</Button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3">
          {templates.isLoading ? <p className="text-sm text-muted-foreground">{tr('Loading templates…')}</p>
            : templates.isError ? <p className="text-sm font-semibold text-red-600">{(templates.error as Error).message}</p>
            : <>
              {inReview.map(row)}
              {!inReview.length && <p className="py-2 text-sm text-muted-foreground">{tr('No template is waiting for approval.')}</p>}
              {approved.length > 0 && (
                <>
                  <button type="button" onClick={() => setShowApproved((v) => !v)} className="mt-2 text-xs font-semibold text-navy underline-offset-2 hover:underline dark:text-gold">
                    {showApproved ? tr('Hide approved templates') : tr('Show the {n} approved templates', { n: approved.length })}
                  </button>
                  {showApproved && <div className="mt-1 max-h-96 overflow-y-auto">{approved.map(row)}</div>}
                </>
              )}
              {templates.dataUpdatedAt > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{tr('Checked with WhatsApp at {time}', { time: new Date(templates.dataUpdatedAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) })}</p>}
            </>}
        </div>
      </CardContent>
    </Card>
  );
}
