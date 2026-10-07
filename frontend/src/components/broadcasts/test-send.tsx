'use client';

import { useState } from 'react';
import { AlertTriangle, Check, CheckCheck, Clock, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { CountryCode } from '@/components/shared/country-code';
import { tr } from '@/i18n';
import { PHONE_COUNTRIES, phoneWithCountry } from '@/lib/utils';
import { BroadcastVariable, useTestSend, useTestStatus } from '@/hooks/use-broadcasts';

// Sends the chosen template to one number typed in by hand, so it can be checked on a real phone
// (any phone, not only a lead's) before it goes to everyone. Shows the message being delivered.
export function TestSend({ contentSid, variables, ready }: { contentSid: string; variables: Record<string, BroadcastVariable>; ready: boolean }) {
  const { toast } = useToast();
  const send = useTestSend();
  const [country, setCountry] = useState('33');
  const [number, setNumber] = useState('');
  const [last, setLast] = useState<{ sid: string; to: string } | null>(null);
  const status = useTestStatus(last?.sid ?? null);
  const full = phoneWithCountry(country, number);

  async function go() {
    if (!full) return;
    try {
      const res = await send.mutateAsync({ contentSid, variables, phone: full });
      setLast({ sid: res.sid, to: res.to });
    } catch (e: any) { toast(e.message || tr('Could not send the test'), 'error'); }
  }

  const s = status.data?.status;
  const line = !last ? null
    : s === 'failed' ? { icon: AlertTriangle, style: 'text-red-600', text: tr('Not delivered to +{n}: {reason}', { n: last.to, reason: tr(status.data?.error || 'Delivery failed') }) }
    : s === 'read' ? { icon: CheckCheck, style: 'text-sky-600', text: tr('Read on +{n}', { n: last.to }) }
    : s === 'delivered' ? { icon: CheckCheck, style: 'text-emerald-700', text: tr('Delivered to +{n}', { n: last.to }) }
    : s === 'sent' ? { icon: Check, style: 'text-muted-foreground', text: tr('Sent to +{n} — waiting for the phone to receive it…', { n: last.to }) }
    : { icon: Clock, style: 'text-muted-foreground', text: tr('Sending to +{n}…', { n: last.to }) };

  return (
    <div className="rounded-lg border border-dashed bg-white p-3 dark:bg-transparent">
      <p className="flex items-center gap-1.5 text-xs font-semibold"><FlaskConical className="h-3.5 w-3.5 text-gold" />{tr('Test on one phone first')}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{tr('Sends this template to any WhatsApp number you type — yours or a colleague’s. It costs one message.')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <CountryCode value={country} onChange={setCountry} />
        <Input className="min-w-[9rem] flex-1" value={number} inputMode="tel" placeholder={PHONE_COUNTRIES.find((c) => c.code === country)?.example} onChange={(e) => setNumber(e.target.value)} />
        <Button variant="outline" disabled={!ready || !full || send.isPending} onClick={go}>{send.isPending ? tr('Sending…') : tr('Send test')}</Button>
      </div>
      {number.trim() && !full && <p className="mt-1 text-[11px] font-semibold text-red-600">{tr('Not a valid phone number')}</p>}
      {!ready && <p className="mt-1 text-[11px] text-muted-foreground">{tr('Choose a template and fill its blanks first.')}</p>}
      {line && <p className={`mt-2 flex items-start gap-1.5 text-xs font-semibold ${line.style}`}><line.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />{line.text}</p>}
    </div>
  );
}
