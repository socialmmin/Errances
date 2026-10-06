'use client';

import { EmployeeReport, ReportView } from '@/components/settings/employee-work';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { ArrowLeft, Mail, Phone, ShieldCheck, Users, Clock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { displayEmail } from '@/lib/display-email';
import { AccessMap, useSaveUserAccess, useUserAccess } from '@/hooks/use-access';

// What each switch actually controls, shown next to it so the admin doesn't have to guess.
const DESCRIPTIONS: Record<string, string> = {
  dashboard: 'The home screen after login',
  'dashboard.meta_ads': 'Ad account balance and spend',
  'dashboard.wa_billing': "This month's WhatsApp message charges",
  'dashboard.coverage': 'Which live ad campaigns have an itinerary ready',
  'dashboard.failed': 'Leads whose WhatsApp itinerary did not deliver',
  'dashboard.calls': "Today's calls, callbacks and follow-ups due",
  'dashboard.new_leads': 'Latest leads coming in',
  'dashboard.quotations': 'Recent quotations and their status',
  leads: 'Lead list and lead details (only their own assigned leads)',
  'leads.add': 'Create a new lead by hand',
  'leads.import': 'Bulk upload leads from an Excel file',
  'leads.export': 'Download leads to Excel',
  'leads.delete': 'Remove leads permanently',
  'leads.assign': 'Hand a lead over to another employee',
  followups: 'Follow-up list and reminders',
  'followups.complete': 'Mark a follow-up done or move it to another time',
  'followups.cancel': 'Cancel a follow-up',
  callbacks: 'Customers who asked for a call back',
  failed_whatsapp: 'Itineraries that failed to send, with retry',
  packages: 'Create and edit packages and itineraries',
  quotations: 'Create, edit and send quotations',
  invoices: 'Invoices and payments',
  whatsapp: 'WhatsApp chats with their own leads',
  reports: 'Business analytics and reports',
  meta_quality: 'Meta ad lead-quality and tracking health',
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const roleLabel = (r?: string | null) => (r || '').replace(/_/g, ' ');

export default function EmployeeAccessPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Two tabs: what they can see (Access) and what they're handling (Assigned leads). ?tab=leads deep-links.
  const tabParam = searchParams.get('tab');
  // ?tab=leads is the old link to the assigned-leads list, now the Leads section of Work.
  const tab: 'access' | ReportView = tabParam === 'performance' ? 'performance' : tabParam === 'work' || tabParam === 'activity' || tabParam === 'leads' ? 'work' : 'access';
  const setTab = (t: 'access' | ReportView) => router.replace(`/settings/users/${id}${t === 'access' ? '' : `?tab=${t}`}`, { scroll: false });
  const { toast } = useToast();
  const { data, isLoading, error } = useUserAccess(id);
  const save = useSaveUserAccess(id);
  const [draft, setDraft] = useState<AccessMap>({});
  useEffect(() => { if (data) setDraft(data.access); }, [data]);

  const pages = useMemo(() => (data?.catalog ?? []).filter((i) => !i.parent), [data]);
  const sectionsOf = (key: string) => (data?.catalog ?? []).filter((i) => i.parent === key);
  const isSuperAdmin = data?.roleName === 'super_admin';
  const changedCount = data ? Object.keys(draft).filter((k) => draft[k] !== data.access[k]).length : 0;
  const u = data?.user;
  const enabledPages = pages.filter((p) => draft[p.key]).length;

  async function submit() {
    try {
      await save.mutateAsync(draft);
      toast(`Access updated for ${u?.full_name ?? 'employee'} — applies on their next page load`, 'success');
    } catch (e: any) {
      toast(e.message || 'Could not save access', 'error');
    }
  }

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="p-6 text-sm text-red-600">Could not load this employee.</p>;

  return (
    <div className="space-y-5 pb-24">
      <Link href="/settings/users" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-navy"><ArrowLeft className="h-4 w-4" />Back to employees</Link>

      {/* Hero: who this is */}
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-center gap-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gold text-xl font-bold text-navy">{initials(u?.full_name ?? '')}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-gold">Access control</p>
            <h1 className="mt-1 truncate text-2xl font-bold">{u?.full_name}</h1>
            <p className="mt-0.5 text-sm capitalize text-slate-300">{roleLabel(data.roleName)}{u?.role_description ? <span className="normal-case"> · {u.role_description}</span> : null}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${u?.is_active ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-slate-300'}`}>{u?.is_active ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-gold" />{u?.phone || '—'}</div>
          <div className="flex min-w-0 items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-gold" /><span className="truncate">{displayEmail(u?.email) || 'No email'}</span></div>
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-gold" />{u?.assigned_leads ?? 0} assigned leads · round-robin {u?.participate_round_robin ? 'on' : 'off'}</div>
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-gold" />Last login {u?.last_login_at ? new Date(u.last_login_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</div>
        </div>
      </section>

      <div className="flex gap-1 border-b border-border">
        {([['access', 'Access'], ['performance', 'Performance'], ['work', `Work & activity (${u?.assigned_leads ?? 0} leads)`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? 'border-gold text-navy dark:text-white' : 'border-transparent text-muted-foreground hover:text-navy'}`}>{label}</button>
        ))}
      </div>

      {tab !== 'access' ? <EmployeeReport userId={id} view={tab} onView={setTab} /> : isSuperAdmin ? (
        <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">A Super Admin always has full access to every page and section. Change their role to restrict them.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-navy dark:text-white"><ShieldCheck className="h-5 w-5 text-gold" />Pages &amp; sections</h2>
              <p className="text-xs text-muted-foreground">{enabledPages} of {pages.length} pages on. Turning a page off hides it and every section inside it.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDraft(data.defaults)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset to role defaults</Button>
          </div>

          {/* Pages with sections: one box each, with its own table of sections. */}
          {pages.filter((pg) => sectionsOf(pg.key).length > 0).map((page) => {
            const on = !!draft[page.key];
            const sections = sectionsOf(page.key);
            return (
              <section key={page.key} className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${on ? 'border-gold/40' : 'border-border'}`}>
                <PageHeader label={page.label} desc={DESCRIPTIONS[page.key]} on={on} def={!!data.defaults[page.key]}
                  extra={`${sections.filter((x) => on && draft[x.key]).length}/${sections.length} sections on`}
                  onChange={(v) => setDraft((d) => ({ ...d, [page.key]: v }))} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-y bg-muted/40 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-2">Section</th>
                        <th className="px-3 py-2">What it controls</th>
                        <th className="px-3 py-2 text-center">Role default</th>
                        <th className="px-5 py-2 text-right">Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((sec) => {
                        const secOn = on && !!draft[sec.key];
                        return (
                          <tr key={sec.key} className={`border-t border-border/50 ${on ? '' : 'opacity-50'}`}>
                            <td className="px-5 py-2.5 text-slate-700 dark:text-slate-300">
                              {sec.label}
                              {sec.sensitive && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">Sensitive</span>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{DESCRIPTIONS[sec.key]}</td>
                            <td className="px-3 py-2.5 text-center"><DefaultTag on={!!data.defaults[sec.key]} /></td>
                            <td className="px-5 py-2.5 text-right"><OnOff on={secOn} disabled={!on} onChange={(v) => setDraft((d) => ({ ...d, [sec.key]: v }))} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          {/* Pages without sections: a box each, side by side. */}
          <div className="grid gap-4 xl:grid-cols-2">
            {pages.filter((pg) => sectionsOf(pg.key).length === 0).map((page) => (
              <section key={page.key} className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${draft[page.key] ? 'border-gold/40' : 'border-border'}`}>
                <PageHeader label={page.label} desc={DESCRIPTIONS[page.key]} on={!!draft[page.key]} def={!!data.defaults[page.key]}
                  onChange={(v) => setDraft((d) => ({ ...d, [page.key]: v }))} />
              </section>
            ))}
          </div>
        </>
      )}

      {tab === 'access' && !isSuperAdmin && (
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-xl border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
          <span className="text-sm text-muted-foreground">{changedCount ? `${changedCount} unsaved change${changedCount > 1 ? 's' : ''}` : 'No unsaved changes'}</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!changedCount} onClick={() => setDraft(data.access)}>Discard</Button>
            <Button disabled={!changedCount || save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save access'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DefaultTag({ on }: { on: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{on ? 'On' : 'Off'}</span>;
}

function OnOff({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`text-xs font-bold ${on ? 'text-emerald-600' : 'text-slate-400'}`}>{on ? 'On' : 'Off'}</span>
      <Switch checked={on} disabled={disabled} onCheckedChange={onChange} />
    </span>
  );
}

function PageHeader({ label, desc, on, def, extra, onChange }: { label: string; desc?: string; on: boolean; def: boolean; extra?: string; onChange: (v: boolean) => void }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 ${on ? 'bg-gold/[0.07]' : 'bg-muted/30'}`}>
      <div className="min-w-[12rem] flex-1">
        <h3 className={`font-semibold ${on ? 'text-navy dark:text-white' : 'text-muted-foreground'}`}>{label}{extra && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{extra}</span>}</h3>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-[10px] font-bold uppercase text-muted-foreground sm:inline">Default</span><DefaultTag on={def} />
        <OnOff on={on} onChange={onChange} />
      </div>
    </div>
  );
}

type AssignedLead = { id: string; lead_number: string; customer_name: string; phone: string | null; whatsapp_number: string | null; destination: string | null; status: string; priority: string | null; created_at: string; last_message_at: string | null; has_follow_up: boolean };
