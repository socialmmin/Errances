'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock, Check, ClipboardList, Edit3, FileText, IndianRupee, Mail, MapPin, MessageCircle, Phone, Plane, Plus, StickyNote, Trash2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAddLeadRequirement, useAssignableUsers, useDeleteLead, useLead, useSetLeadCollaborators, useUpdateLead } from '@/hooks/use-leads';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LeadRequirement } from '@/types/lead';
import { LeadForm } from '@/components/leads/lead-form';
import { FollowUpPanel } from '@/components/leads/follow-up-panel';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { Skeleton } from '@/components/ui/skeleton';
import { LEAD_STATUSES, STATUS_GROUPS, leadStatusLabel } from '@/lib/lead-statuses';
import { usePermission } from '@/hooks/use-permission';
import { ManualSendBanner } from '@/components/shared/manual-send';
import { WhatsAppChoice } from '@/components/shared/whatsapp-choice';
import { LeadNotesFeed } from '@/components/leads/lead-notes-feed';
import { useLeadNotesFeed } from '@/hooks/use-lead-notes';
import { tr, locale } from '@/i18n';

const PIPELINE = LEAD_STATUSES;

// 'edit' is intentionally not in this list -- it's reached only via the Edit
// button in the header above, not as its own tab, since having both was a
// duplicate way to get to the same form.
const TABS = [
  { value: 'overview', label: 'Overview', icon: ClipboardList },
  { value: 'requirements', label: 'Requirements', icon: Plane },
  { value: 'followup', label: 'Follow-up', icon: CalendarClock },
  { value: 'quotation', label: 'Quotation', icon: FileText },
  { value: 'notes', label: 'Notes', icon: StickyNote },
] as const;
type Tab = (typeof TABS)[number]['value'] | 'edit';

function formatLabel(value?: string | null) {
  return value ? leadStatusLabel(value) : '—';
}

function sourceLabel(lead: { source: string | null; meta_attribution: Record<string, unknown> | null }) {
  if (lead.source !== 'meta_ads') return formatLabel(lead.source);
  const platform = String(lead.meta_attribution?.platform || '').toLowerCase();
  if (platform === 'ig' || platform.includes('instagram')) return 'Instagram Ads';
  if (platform === 'fb' || platform.includes('facebook')) return 'Facebook Ads';
  return 'Meta Ads';
}

function Detail({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ElementType }) {
  return <div className="flex gap-3 rounded-lg border border-border bg-background p-3"><div className="rounded-lg bg-gold/10 p-2 text-gold"><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs text-muted-foreground">{tr(label)}</p><div className="mt-0.5 break-words text-sm font-medium">{value || '—'}</div></div></div>;
}

function RequirementCard({ requirement, number }: { requirement: LeadRequirement; number: number }) {
  const answers = Object.entries(requirement.answers || {}).filter(([key]) => !['full_name', 'first_name', 'last_name', 'phone_number', 'email'].includes(key.toLowerCase()));
  return <section className="rounded-xl border border-border p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-navy dark:text-white">{tr("Requirement")}{' '}{number}: {requirement.destination || tr("Tour enquiry")}</h2><span className="text-xs text-muted-foreground">{new Date(requirement.submitted_at).toLocaleString(locale())}</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Detail label={tr("Destination")} value={requirement.destination || '—'} icon={MapPin} /><Detail label={tr("Campaign")} value={requirement.campaign_name || '—'} icon={Plane} /><Detail label={tr("Ad")} value={requirement.ad_name || '—'} icon={ClipboardList} /><Detail label={tr("Instant Form")} value={requirement.form_name || '—'} icon={FileText} /><Detail label={tr("Travel dates")} value={`${requirement.travel_from || 'Not set'}${requirement.travel_to ? ` to ${requirement.travel_to}` : ''}`} icon={CalendarClock} /><Detail label={tr("Travellers")} value={`${requirement.adults ?? 1} adults, ${requirement.children ?? 0} children, ${requirement.infants ?? 0} infants`} icon={User} /><Detail label={tr("Budget")} value={requirement.budget ? `₹${Number(requirement.budget).toLocaleString(locale())}` : '—'} icon={IndianRupee} /></div>{answers.length > 0 && <div className="mt-4 overflow-hidden rounded-lg border"><div className="bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("Instant Form questions and answers")}</div><div className="divide-y">{answers.map(([question, answer]) => <div key={question} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(180px,1fr)_2fr]"><span className="text-sm text-muted-foreground">{formatLabel(question)}</span><span className="text-sm font-medium">{answer || '—'}</span></div>)}</div></div>}{requirement.notes && <p className="mt-3 rounded-lg bg-muted/30 p-3 text-sm">{requirement.notes}</p>}</section>;
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: lead, isLoading } = useLead(id);
  const { data: notesFeed } = useLeadNotesFeed(id);
  const recentNotes = (notesFeed?.data ?? []).slice(0, 3);
  const updateMutation = useUpdateLead(id);
  const deleteMutation = useDeleteLead();
  const addRequirement = useAddLeadRequirement(id);
  const collaboratorsMutation = useSetLeadCollaborators(id);
  const { can } = usePermission();
  const canAssign = can(PERMISSIONS.LEADS_ASSIGN);
  const { data: assignableUsers } = useAssignableUsers(canAssign);
  const [tab, setTab] = useState<Tab>('overview');
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [requirement, setRequirement] = useState({ destination: '', travelFrom: '', travelTo: '', adults: 1, children: 0, infants: 0, budget: '', notes: '' });

  async function onDelete() {
    const ok = await confirm({ title: tr("Delete this lead?"), description: tr("This lead will be removed from active CRM views."), confirmLabel: tr("Delete"), variant: 'destructive' });
    if (!ok) return;
    await deleteMutation.mutateAsync(id);
    toast(tr("Lead deleted"), 'success');
    router.push('/leads');
  }

  async function setPipelineStatus(status: string) {
    try {
      await updateMutation.mutateAsync({ status });
      toast(tr("Lead moved to {value}", { value: formatLabel(status) }), 'success');
    } catch (error: any) { toast(error.message || tr("Could not update lead status"), 'error'); }
  }

  async function saveRequirement(event: React.FormEvent) {
    event.preventDefault();
    try {
      await addRequirement.mutateAsync({ ...requirement, budget: requirement.budget ? Number(requirement.budget) : 0 });
      setRequirement({ destination: '', travelFrom: '', travelTo: '', adults: 1, children: 0, infants: 0, budget: '', notes: '' });
      setShowRequirementForm(false);
      toast(tr("Requirement saved"), 'success');
    } catch (error: any) { toast(error.message || tr("Could not save requirement"), 'error'); }
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (!lead) return <p>{tr("Lead not found.")}</p>;

  const phone = lead.whatsapp_number || lead.phone;
  const digits = phone?.replace(/\D/g, '') || '';
  const initials = lead.customer_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const activeIndex = Math.max(0, PIPELINE.findIndex((stage) => stage.value === lead.status));

  return (
  <div className="space-y-4">
    <Card className="overflow-hidden border-gold/20 bg-gradient-to-r from-navy via-navy-900 to-navy-800 text-white shadow-lg"><CardContent className="flex flex-wrap items-center justify-between gap-5 p-6">
      <div className="flex items-center gap-4"><Button variant="ghost" size="icon" className="text-slate-300 hover:bg-white/10 hover:text-gold" onClick={() => router.push('/leads')} aria-label={tr("Back to leads")}><ArrowLeft className="h-5 w-5" /></Button><div className="grid h-14 w-14 place-items-center rounded-xl bg-gold text-lg font-bold text-navy shadow-[0_8px_24px_-8px_rgba(245,158,11,.8)]">{initials}</div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-white">{lead.customer_name}</h1><span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-100 ring-1 ring-white/15">{formatLabel(lead.status)}</span></div><p className="mt-1 text-xs text-slate-400">{lead.lead_number}{' '}{tr("· Added")}{' '}{new Date(lead.created_at).toLocaleDateString(locale())}</p></div></div>
      <div className="flex flex-wrap items-center gap-2"><Button disabled={!lead.phone} variant="gold" onClick={() => { if (lead.phone) window.location.href = `tel:${lead.phone}`; }} className="gap-2"><Phone className="h-4 w-4" />{' '}{tr("Call")}</Button><WhatsAppChoice leadId={lead.id} phone={phone || ''} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-50"><MessageCircle className="h-4 w-4" />{' '}{tr("WhatsApp")}</WhatsAppChoice><Button variant="outline" className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" onClick={() => setTab('followup')}><CalendarClock className="h-4 w-4" />{' '}{tr("Follow-up")}</Button><Button variant="outline" className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" onClick={() => setTab('edit')}><Edit3 className="h-4 w-4" />{' '}{tr("Edit")}</Button><PermissionGuard permission={PERMISSIONS.LEADS_DELETE}><Button variant="ghost" size="icon" className="hover:bg-red-500/15" onClick={onDelete} aria-label={tr("Delete lead")}><Trash2 className="h-4 w-4 text-red-400" /></Button></PermissionGuard></div>
    </CardContent></Card>

    <ManualSendBanner leadId={lead.id} />
    <Card className="overflow-hidden"><div className="flex overflow-x-auto border-b border-border bg-muted/35">{TABS.map((item) => { const Icon = item.icon; return <button key={item.value} onClick={() => setTab(item.value)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${tab === item.value ? 'border-gold text-navy dark:text-gold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}><Icon className="h-4 w-4" />{tr(item.label)}</button>; })}</div>
      <CardContent className="space-y-5 p-5">
        {tab !== 'edit' && (
          <section className="rounded-xl border border-border bg-muted/20 p-4">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("Pipeline stage")}</p>
            <div className="flex min-w-max items-start overflow-x-auto pb-2">
              {PIPELINE.map((stage, index) => {
                const complete = index < activeIndex;
                const active = index === activeIndex;
                return (
                  <div key={stage.value} className="flex items-start">
                    <button disabled={updateMutation.isPending} onClick={() => setPipelineStatus(stage.value)} className="group flex w-24 flex-col items-center gap-2">
                      <span className={`grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-bold transition ${complete ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-gold bg-gold text-navy' : 'border-border bg-background text-muted-foreground group-hover:border-gold'}`}>
                        {complete ? <Check className="h-4 w-4" /> : index + 1}
                      </span>
                      <span className={`text-center text-[11px] ${active ? 'font-semibold text-navy dark:text-gold' : 'text-muted-foreground'}`}>{tr(stage.label)}</span>
                    </button>
                    {index < PIPELINE.length - 1 && <div className={`mt-4 h-0.5 w-10 ${index < activeIndex ? 'bg-emerald-500' : 'bg-border'}`} />}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'overview' && <><section className="rounded-xl border border-gold/30 bg-gold/5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-gold">{tr("Lead summary")}</p><p className="mt-2 text-sm leading-6"><strong>{lead.customer_name}</strong>{' '}{tr("has")}{' '}<strong>{lead.requirements?.length || 0}{' '}{tr("tour requirement(s)")}</strong>{tr(". Latest interest:")}{' '}<strong>{lead.destination || tr("a tour package")}</strong>{tr("; assigned to")}{' '}<strong>{lead.assigned_to_name || tr("no employee yet")}</strong>.</p>{recentNotes.length > 0 && <div className="mt-3 space-y-1 border-t border-gold/20 pt-2"><p className="text-[11px] font-bold uppercase tracking-wide text-gold">{tr("Recently spoken / mentioned")}</p>{recentNotes.map((n) => <p key={n.id} className="text-xs leading-5 text-foreground"><span className="text-muted-foreground">{new Date(n.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}{n.by ? ` · ${n.by}` : ''}:</span> {n.body}</p>)}</div>}</div><div className="min-w-56"><Label htmlFor="quick-lead-status">{tr("Status")}</Label><select id="quick-lead-status" className="mt-1 h-10 w-full rounded-md border border-gold/40 bg-background px-3 text-sm font-semibold text-foreground" value={lead.status} disabled={updateMutation.isPending} onChange={(event)=>setPipelineStatus(event.target.value)}>{STATUS_GROUPS.map((g)=><optgroup key={g.key} label={tr(g.label)}>{g.statuses.map((stage)=><option key={stage.value} value={stage.value}>{tr(stage.label)}</option>)}</optgroup>)}</select></div></div></section><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label={tr("Phone")} value={lead.phone || '—'} icon={Phone} /><Detail label={tr("WhatsApp")} value={lead.whatsapp_number || '—'} icon={MessageCircle} /><Detail label={tr("Email")} value={lead.email || '—'} icon={Mail} /><Detail label={tr("Latest destination")} value={lead.destination || '—'} icon={MapPin} /><Detail label={tr("Travellers")} value={`${lead.adults ?? 1} adults, ${lead.children ?? 0} children, ${lead.infants ?? 0} infants`} icon={User} /><Detail label={tr("Latest campaign")} value={lead.campaign_name || '—'} icon={Plane} /><Detail label={tr("Source")} value={sourceLabel(lead)} icon={User} /><Detail label={tr("Budget")} value={lead.budget ? `₹${Number(lead.budget).toLocaleString(locale())}` : '—'} icon={IndianRupee} /><Detail label={tr("Assigned to")} value={lead.assigned_to_name || tr("Unassigned")} icon={User} /></div>{canAssign && <section className="rounded-xl border border-border p-4"><h2 className="font-semibold text-navy dark:text-white">{tr("Assignment and collaboration")}</h2><div className="mt-3 grid gap-4 md:grid-cols-2"><div><Label>{tr("Transfer lead to")}</Label><select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={lead.assigned_to || ''} onChange={(event)=>updateMutation.mutateAsync({assignedTo:event.target.value} as any).then(()=>toast(tr("Lead transferred"),'success'))}><option value="">{tr("Unassigned")}</option>{(assignableUsers?.data || []).map((user)=><option key={user.id} value={user.id}>{user.full_name}</option>)}</select></div><div><Label>{tr("Collaborators who can also access this lead")}</Label><div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-input p-2">{(assignableUsers?.data || []).filter((user)=>user.id !== lead.assigned_to).map((user)=>{const checked=(lead.collaborators||[]).some((item)=>item.id===user.id);return <label key={user.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" checked={checked} disabled={collaboratorsMutation.isPending} onChange={()=>{const current=(lead.collaborators||[]).map((item)=>item.id);collaboratorsMutation.mutate(checked?current.filter((value)=>value!==user.id):[...current,user.id],{onSuccess:()=>toast(tr("Collaborators updated"),'success')});}} />{user.full_name}</label>})}</div></div></div></section>}{lead.requirements?.[0] && <><h2 className="text-sm font-semibold text-navy dark:text-white">{tr("Latest requirement and Instant Form answers")}</h2><RequirementCard requirement={lead.requirements[0]} number={lead.requirements.length} /></>}</>}

        {tab === 'requirements' && <div className="space-y-3"><div className="flex justify-end"><Button variant="gold" className="gap-2" onClick={() => setShowRequirementForm((value) => !value)}><Plus className="h-4 w-4" />{' '}{tr("Add requirement")}</Button></div>{showRequirementForm && <form onSubmit={saveRequirement} className="space-y-4 rounded-xl border border-gold/40 bg-gold/5 p-4"><h2 className="font-semibold">{tr("Collect new requirement")}</h2><div className="grid gap-4 sm:grid-cols-2"><div><Label>{tr("Destination")}</Label><Input required value={requirement.destination} onChange={(e) => setRequirement({...requirement,destination:e.target.value})} /></div><div><Label>{tr("Budget (₹)")}</Label><Input type="number" min="0" value={requirement.budget} onChange={(e) => setRequirement({...requirement,budget:e.target.value})} /></div><div><Label>{tr("Travel from")}</Label><Input type="date" value={requirement.travelFrom} onChange={(e) => setRequirement({...requirement,travelFrom:e.target.value})} /></div><div><Label>{tr("Travel to")}</Label><Input type="date" value={requirement.travelTo} onChange={(e) => setRequirement({...requirement,travelTo:e.target.value})} /></div><div><Label>{tr("Adults")}</Label><Input type="number" min="0" value={requirement.adults} onChange={(e) => setRequirement({...requirement,adults:Number(e.target.value)})} /></div><div><Label>{tr("Children")}</Label><Input type="number" min="0" value={requirement.children} onChange={(e) => setRequirement({...requirement,children:Number(e.target.value)})} /></div></div><div><Label>{tr("Notes / other answers")}</Label><textarea className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm" value={requirement.notes} onChange={(e) => setRequirement({...requirement,notes:e.target.value})} /></div><div className="flex gap-2"><Button type="submit" variant="gold" disabled={addRequirement.isPending}>{addRequirement.isPending ? tr("Saving…") : tr("Save requirement")}</Button><Button type="button" variant="outline" onClick={() => setShowRequirementForm(false)}>{tr("Cancel")}</Button></div></form>}{lead.requirements?.length ? lead.requirements.map((item, index) => <RequirementCard key={item.id} requirement={item} number={lead.requirements!.length - index} />) : <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{tr("No tour requirements recorded yet.")}</div>}</div>}
        {tab === 'followup' && <FollowUpPanel leadId={String(id)} />}
        {tab === 'quotation' && <div className="rounded-xl border border-border p-5"><h2 className="font-semibold text-navy dark:text-white">{tr("Quotation and itinerary")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("Create a quotation for")}{' '}{lead.customer_name}{tr(", then send its secure link through WhatsApp.")}</p><Link href="/quotations/new"><Button variant="gold" className="mt-4 gap-2"><FileText className="h-4 w-4" />{' '}{tr("Create quotation")}</Button></Link></div>}
        {tab === 'notes' && <LeadNotesFeed leadId={id} />}
        {tab === 'edit' && <LeadForm lead={lead} />}
      </CardContent>
    </Card>
  </div>
  );
}
