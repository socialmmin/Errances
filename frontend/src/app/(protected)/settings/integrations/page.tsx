'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useWhatsAppHealth } from '@/hooks/use-whatsapp';
import { Button } from '@/components/ui/button';

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A check's real pass/fail state, not just "configured" (which only ever meant "credentials are
// saved" -- a credential can be saved and still be completely dead, exactly what happened when
// the WhatsApp inbound webhook silently stopped for days while everything still said
// "Connected"). Each row here is evaluated from the live Graph API / the actual message log, not
// assumed.
function StatusRow({ label, state, detail }: { label: string; state: 'ok' | 'warn' | 'bad' | 'unknown'; detail?: string }) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'bad' ? XCircle : AlertTriangle;
  const color = state === 'ok' ? 'text-emerald-600' : state === 'bad' ? 'text-red-600' : state === 'warn' ? 'text-amber-600' : 'text-slate-400';
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
        <div>
          <p className="text-sm font-semibold text-navy">{label}</p>
          {detail && <p className="mt-0.5 text-xs text-slate-500">{detail}</p>}
        </div>
      </div>
    </div>
  );
}

const CONNECTIONS = [
  { key: 'whatsapp', name: 'WhatsApp Cloud API' },
  { key: 'meta_ads', name: 'Meta Ads' },
  { key: 'storage', name: 'Cloudflare R2 Storage' },
  { key: 'push', name: 'Push Notifications' },
] as const;

function WhatsAppSection() {
  const { data: health, isLoading, isFetching, refetch } = useWhatsAppHealth();
  const status = isLoading ? 'checking' : !health?.configured ? 'not_configured' : health.inboundStale ? 'bad' : (!health.tokenValid || !health.secretValid || !health.subscribed) ? 'warn' : 'ok';
  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-navy">WhatsApp Cloud API</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" disabled={isFetching}><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
          {status === 'checking' && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">Checking…</span>}
          {status === 'not_configured' && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Not configured</span>}
          {status === 'bad' && <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">Disconnected — inbound not arriving</span>}
          {status === 'warn' && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Needs attention</span>}
          {status === 'ok' && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Connected — verified live</span>}
        </div>
      </div>

      {health?.configured && (
        <div className="mt-4">
          {health.inboundStale && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800">Why this is disconnected: customers are not reaching you on WhatsApp right now.</p>
              <p className="mt-1 text-xs text-red-700">
                Messages are still sending out ({health.recentOutboundCount} in the last 24h), but no reply or button tap has come back in over a day.
                This is exactly what happens when Meta's "messages" webhook field gets unsubscribed in the App Dashboard, even while everything else still looks connected.
                Go to Meta Business Manager → App → WhatsApp → Configuration → Webhook fields, and confirm "messages" is checked.
              </p>
            </div>
          )}
          <StatusRow label="Access token" state={health.tokenValid ? 'ok' : 'bad'} detail={health.tokenValid ? `Valid — app: ${health.appName || health.appId || 'unknown'}` : "Invalid or expired — sends and status checks will fail"} />
          <StatusRow label="App secret (webhook signature)" state={health.secretValid ? 'ok' : 'bad'} detail={health.secretValid ? `Verified via ${health.secretSource === 'crm' ? 'the key saved in this CRM' : 'the server environment'}` : 'Could not verify — inbound webhooks may be getting rejected'} />
          <StatusRow label="App subscribed to this WhatsApp number" state={health.subscribed ? 'ok' : 'bad'} detail={health.provider === 'twilio' ? (health.subscribed ? 'Twilio sender is online and delivers incoming messages to this CRM' : 'The Twilio sender is offline or its webhook address does not point to this CRM') : health.subscribed ? 'Confirmed with Meta' : 'Not subscribed — Meta will not deliver any webhook events at all'} />
          <StatusRow label="Inbound messages (replies, button taps)" state={health.inboundStale ? 'bad' : health.lastInboundAt ? 'ok' : 'unknown'} detail={`${health.inboundCount} received total · last one ${timeAgo(health.lastInboundAt)}`} />
          <StatusRow label="Outbound sends (last 24h)" state={health.recentOutboundCount > 0 ? 'ok' : 'unknown'} detail={`${health.recentOutboundCount} sent`} />
          <StatusRow label="Webhook signature rejections" state={health.lastRejectedAt && Date.now() - new Date(health.lastRejectedAt).getTime() < 3600000 ? 'warn' : 'ok'} detail={health.lastRejectedAt ? `Last rejected ${timeAgo(health.lastRejectedAt)} — check the App Secret` : 'None recently'} />
          <StatusRow label="Number quality rating" state={health.qualityRating === 'GREEN' ? 'ok' : health.qualityRating === 'YELLOW' ? 'warn' : health.qualityRating === 'RED' ? 'bad' : 'unknown'} detail={health.qualityRating ? `${health.qualityRating}${health.throughputTier ? ` · throughput: ${health.throughputTier}` : ''}` : 'Not available right now'} />
        </div>
      )}
      {!health?.configured && !isLoading && (
        <p className="mt-3 text-sm text-slate-500">WhatsApp isn't configured yet. <Link href="/settings/whatsapp" className="font-semibold text-gold underline">Set it up</Link>.</p>
      )}
      <p className="mt-4 text-xs text-slate-400">Checked against the real {health?.provider === 'twilio' ? 'Twilio' : 'Meta Graph'} API and this CRM's own message log every time this loads, and every 30 seconds automatically — never just "a key is saved."</p>
    </section>
  );
}

type State = 'ok' | 'warn' | 'bad' | 'unknown';
type Health = { checkedAt: string; metaAds: any; storage: any; push: any };

// One live call for Meta Ads, storage and push (each check hits the real service on the server).
function useConnectionsHealth() {
  return useQuery({
    queryKey: ['connections-health'],
    queryFn: () => api.get<Health>('/integrations/connections-health'),
    refetchInterval: 60_000,
  });
}

const AD_STATUS: Record<number, string> = { 1: 'Active', 2: 'Disabled', 3: 'Unsettled payment', 7: 'Pending risk review', 8: 'Pending settlement', 9: 'In grace period', 100: 'Pending closure', 101: 'Closed' };

function overall(states: State[]): { label: string; cls: string } {
  if (states.includes('bad')) return { label: 'Problem — see below', cls: 'bg-red-100 text-red-700' };
  if (states.includes('warn')) return { label: 'Needs attention', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Connected — verified live', cls: 'bg-emerald-100 text-emerald-700' };
}

function LiveSection({ title, rows, isLoading, isFetching, refetch, notConfigured, footer }: { title: string; rows: { label: string; state: State; detail?: string }[]; isLoading: boolean; isFetching: boolean; refetch: () => void; notConfigured?: string | null; footer: string }) {
  const badge = overall(rows.map((r) => r.state));
  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-navy">{title}</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" disabled={isFetching}><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
          {isLoading ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">Checking…</span>
            : notConfigured ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Not configured</span>
            : <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge.cls}`}>{badge.label}</span>}
        </div>
      </div>
      {notConfigured && !isLoading && <p className="mt-3 text-sm text-slate-500">{notConfigured}</p>}
      {!notConfigured && !isLoading && <div className="mt-4">{rows.map((r) => <StatusRow key={r.label} {...r} />)}</div>}
      <p className="mt-4 text-xs text-slate-400">{footer}</p>
    </section>
  );
}

function MetaAdsSection() {
  const { data, isLoading, isFetching, refetch, error } = useConnectionsHealth();
  const m = data?.metaAds ?? {};
  const ad = m.adAccount ?? {};
  const leadAgeH = m.lastLeadAt ? (Date.now() - new Date(m.lastLeadAt).getTime()) / 3600000 : null;
  const rows: { label: string; state: State; detail?: string }[] = [
    { label: 'Facebook Page access (lead forms)', state: m.page?.ok ? 'ok' : 'bad', detail: m.page?.ok ? `Valid — page: ${m.page.name || 'unknown'}` : `Failed — ${m.page?.error || 'unknown error'}. New Meta leads cannot be fetched.` },
    { label: 'Ad account', state: !ad.connected ? 'bad' : ad.status === 1 ? 'ok' : 'bad', detail: !ad.connected ? `Cannot read the ad account — ${ad.error || 'unknown error'}` : `${ad.name || 'Account'} · ${AD_STATUS[ad.status] || `status ${ad.status}`}` },
    { label: 'Prepaid balance', state: !ad.connected ? 'unknown' : ad.warningLevel === 'critical' ? 'bad' : ad.warningLevel === 'low' ? 'warn' : 'ok', detail: ad.connected ? `₹${Number(ad.balance || 0).toLocaleString('en-IN')} left${ad.warningLevel !== 'healthy' ? ' — recharge soon or campaigns will stop' : ''}` : 'Not available' },
    { label: 'Lead recovery sync (every 5 min)', state: !m.lastSync ? 'unknown' : m.lastSync.ok ? 'ok' : 'bad', detail: !m.lastSync ? 'Has not run since the server last restarted' : m.lastSync.ok ? `Last ran ${timeAgo(m.lastSync.at)} · ${m.lastSync.imported ?? 0} recovered` : `Failed ${timeAgo(m.lastSync.at)} — ${m.lastSync.error}` },
    { label: 'Meta leads arriving', state: leadAgeH == null ? 'unknown' : leadAgeH > 48 && ad.status === 1 ? 'warn' : 'ok', detail: `${m.leads24h ?? 0} in the last 24h · last one ${timeAgo(m.lastLeadAt ?? null)}${leadAgeH != null && leadAgeH > 48 && ad.status === 1 ? ' — no leads in 2+ days while the account is active; check campaigns are running' : ''}` },
  ];
  return <LiveSection title="Meta Ads" rows={rows} isLoading={isLoading} isFetching={isFetching} refetch={refetch}
    notConfigured={error ? `Could not run the check: ${(error as Error).message}` : !isLoading && m.configured === false ? 'META_PAGE_ID / META_PAGE_ACCESS_TOKEN are not set on the server.' : null}
    footer="Checked live against the Meta Graph API (Page, ad account) and this CRM's own lead log, every minute while open." />;
}

function StorageSection() {
  const { data, isLoading, isFetching, refetch, error } = useConnectionsHealth();
  const st = data?.storage ?? {};
  const rows: { label: string; state: State; detail?: string }[] = [
    { label: 'Bucket reachable', state: st.reachable ? 'ok' : 'bad', detail: st.reachable ? `${st.bucket} · responded in ${st.latencyMs} ms` : `Cannot reach the bucket — ${st.error || 'unknown error'}` },
    { label: 'Upload & read back test file', state: st.writable ? 'ok' : st.reachable ? 'bad' : 'unknown', detail: st.writable ? 'Write and read both work — itinerary PDFs and attachments can be uploaded' : st.reachable ? `Bucket is reachable but uploads fail — ${st.error || 'check the key has write permission'}` : 'Skipped (bucket not reachable)' },
  ];
  return <LiveSection title="Cloudflare R2 Storage" rows={rows} isLoading={isLoading} isFetching={isFetching} refetch={refetch}
    notConfigured={error ? `Could not run the check: ${(error as Error).message}` : !isLoading && st.configured === false ? 'R2 credentials are not set on the server.' : null}
    footer="Each check writes a tiny test file to the bucket and reads it back — a real upload, not just a saved key." />;
}

function PushSection() {
  const { data, isLoading, isFetching, refetch, error } = useConnectionsHealth();
  const p = data?.push ?? {};
  const d = p.lastDelivery;
  const rows: { label: string; state: State; detail?: string }[] = [
    { label: 'Push keys (VAPID)', state: p.configured ? 'ok' : 'bad', detail: p.configured ? 'Configured on the server' : 'Missing — no notifications can be sent' },
    { label: 'Devices subscribed', state: !p.devices ? 'bad' : p.admins ? 'ok' : 'warn', detail: `${p.devices ?? 0} device(s) · ${p.users ?? 0} employee(s)${p.admins ? '' : ' · no super admin device is subscribed, so critical alerts reach nobody in charge'} · last added ${timeAgo(p.last_subscribed ?? null)}` },
    { label: 'Last delivery', state: !d ? 'unknown' : d.failed && !d.sent ? 'bad' : d.failed ? 'warn' : 'ok', detail: !d ? 'Nothing sent since the server last restarted' : `${timeAgo(d.at)} — "${d.title}" · ${d.sent} delivered, ${d.failed} failed${d.error ? ` (${d.error})` : ''}` },
  ];
  return <LiveSection title="Push Notifications" rows={rows} isLoading={isLoading} isFetching={isFetching} refetch={refetch}
    notConfigured={error ? `Could not run the check: ${(error as Error).message}` : null}
    footer="Delivery results come from the server's real sends to each subscribed browser." />;
}

export default function IntegrationsMonitorPage() {
  const params = useSearchParams();
  const key = params.get('key');
  const selected = CONNECTIONS.find((c) => c.key === key);
  const list = selected ? [selected] : CONNECTIONS;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-navy dark:text-white">{selected ? selected.name : 'All connections'}</h1>
        <p className="text-sm text-muted-foreground">{selected ? 'What this connection is doing right now, and exactly why, if something is wrong.' : 'Every external connection the CRM depends on.'}</p>
        {selected && <Link href="/settings/integrations" className="mt-1 inline-block text-xs font-semibold text-gold underline">← All connections</Link>}
      </div>

      {list.map((c) => c.key === 'whatsapp' ? <WhatsAppSection key={c.key} /> : c.key === 'meta_ads' ? <MetaAdsSection key={c.key} /> : c.key === 'storage' ? <StorageSection key={c.key} /> : <PushSection key={c.key} />)}
    </div>
  );
}
