'use client';

import { formatPhone } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { CalendarDays, Columns3, Download, Eye, LayoutGrid, MessageCircle, Phone, Table2, Upload, X } from 'lucide-react';
import { DataTable } from '@/components/shared/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { usePermission } from '@/hooks/use-permission';
import { useLeads, useLeadCampaigns, useLeadStats, useAssignableUsers, useBulkAssignLeads, useQuickUpdateLead, useCampaignSummary } from '@/hooks/use-leads';
import { useMetaCampaigns } from '@/hooks/use-packages';
import { Lead } from '@/types/lead';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/components/ui/toast';
import { LEAD_STATUSES, STATUS_GROUPS, leadStatusLabel, QUALITY_STYLE } from '@/lib/lead-statuses';
import { ReasonDialog, needsReason } from '@/components/leads/reason-dialog';
import { stageDestination } from '@/lib/stage-actions';
import { CampaignFilterSelect } from '@/components/leads/campaign-filter-select';
import { AddLeadModal } from '@/components/leads/add-lead-modal';
import { StatusGuide } from '@/components/leads/status-guide';
import { WhatsAppChoice } from '@/components/shared/whatsapp-choice';

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground';

const SOURCES = ['website', 'referral', 'walk_in', 'social_media', 'phone', 'whatsapp', 'agent', 'meta_ads', 'other'];
const PAGE_SIZE = 30;
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function sourceLabel(lead: Lead) {
  if (lead.source !== 'meta_ads') return String(lead.source || '—').replace(/_/g, ' ');
  const platform = String(lead.meta_attribution?.platform || '').toLowerCase();
  if (platform === 'ig' || platform.includes('instagram')) return 'Instagram Ads';
  if (platform === 'fb' || platform.includes('facebook')) return 'Facebook Ads';
  return 'Meta Ads';
}

export default function LeadsPage() {
  const router = useRouter();
  const { can } = usePermission();
  const { toast } = useToast();
  const canAssign = can(PERMISSIONS.LEADS_ASSIGN);
  const canEdit = can(PERMISSIONS.LEADS_EDIT);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [noPhone, setNoPhone] = useState(false);
  const [itineraryStatus, setItineraryStatus] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'table' | 'board' | 'cards'>('table');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCampaigns, setExportCampaigns] = useState<Set<string>>(new Set());
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('leads-view-mode');
    if (saved === 'table' || saved === 'board' || saved === 'cards') setViewMode(saved);
  }, []);

  // Accumulates each page's rows as the list scrolls (instead of replacing them, like a normal
  // page-1-only fetch would) -- "keep scrolling and it should keep loading" per the business
  // owner's own words, instead of a Previous/Next click. Reset to empty on the exact same filter
  // changes that already reset `page` back to 1, since those start a brand-new result set.
  const [accumulatedLeads, setAccumulatedLeads] = useState<Lead[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPage(1);
    setAccumulatedLeads([]);
    setSelected(new Set());
  }, [search, status, source, campaignName, noPhone, itineraryStatus, assignedTo, dateFrom, dateTo]);

  const { data, isLoading, isError, error } = useLeads({
    search: search || undefined,
    status: status || undefined,
    source: source || undefined,
    campaignName: campaignName || undefined,
    noPhone: noPhone || undefined,
    itineraryStatus: (itineraryStatus || undefined) as 'read' | 'delivered' | 'sent' | 'unconfirmed' | 'failed' | 'none' | undefined,
    assignedTo: assignedTo || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: viewMode === 'board' ? 500 : PAGE_SIZE,
  });
  const { data: stats } = useLeadStats();
  const { data: campaigns } = useLeadCampaigns();
  const { data: metaCampaigns } = useMetaCampaigns();
  const { data: campaignSummary } = useCampaignSummary(campaignName);
  // Union of every live Meta campaign (so a brand-new one shows up immediately,
  // before it has any leads) with the campaigns we already have lead counts for.
  const filterCampaigns = useMemo(() => {
    const counts = new Map((campaigns ?? []).map((c) => [c.campaign_name, c.lead_count]));
    const names = new Set([...(metaCampaigns?.data ?? []).map((c) => c.name), ...counts.keys()]);
    return Array.from(names)
      .map((name) => ({ campaign_name: name, lead_count: counts.get(name) ?? 0 }))
      .sort((a, b) => a.campaign_name.localeCompare(b.campaign_name));
  }, [campaigns, metaCampaigns?.data]);
  const { data: assignableUsers } = useAssignableUsers();
  const bulkAssign = useBulkAssignLeads();
  const quickUpdate = useQuickUpdateLead();
  const [reasonFor, setReasonFor] = useState<{ lead: Lead; status: string } | null>(null);
  const hasCampaignOptions = (campaigns?.length ?? 0) > 0;
  const selectedExportLeadCount = hasCampaignOptions ? (campaigns ?? []).reduce(
    (sum, campaign) => sum + (exportCampaigns.has(campaign.campaign_name) ? campaign.lead_count : 0),
    0,
  ) : (data?.total ?? 0);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const leads = viewMode === 'board' ? (data?.data ?? []) : accumulatedLeads;
  // Only the very first fetch should blank the list to a skeleton -- every subsequent page
  // loading in behind the scroll sentinel must not wipe out everything already rendered.
  const isInitialLoading = viewMode === 'board' ? isLoading : isLoading && accumulatedLeads.length === 0;

  useEffect(() => {
    if (viewMode === 'board' || !data) return;
    setAccumulatedLeads((prev) => {
      if (page === 1) return data.data;
      // Dedupe in case a refetch (e.g. a socket-driven invalidation) re-delivers a page we
      // already appended -- keeps a fast-updating list from ever showing the same row twice.
      const seen = new Set(prev.map((l) => l.id));
      return [...prev, ...data.data.filter((l) => !seen.has(l.id))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page, viewMode]);

  useEffect(() => {
    if (viewMode === 'board') return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isLoading && page < totalPages) {
        setPage((p) => p + 1);
      }
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading, page, totalPages, viewMode]);

  function changeView(mode: 'table' | 'board' | 'cards') {
    setViewMode(mode);
    window.localStorage.setItem('leads-view-mode', mode);
  }

  function localDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function applyDatePreset(preset: 'today' | 'yesterday' | '7' | '14' | '30' | 'month') {
    const end = new Date();
    const start = new Date();
    if (preset === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    if (preset === '7' || preset === '14' || preset === '30') start.setDate(start.getDate() - Number(preset) + 1);
    if (preset === 'month') start.setDate(1);
    setDateFrom(localDate(start)); setDateTo(localDate(end)); setDateMenuOpen(false);
  }

  const dateLabel = dateFrom || dateTo
    ? `${dateFrom ? new Date(`${dateFrom}T00:00:00`).toLocaleDateString('en-IN') : 'Start'} – ${dateTo ? new Date(`${dateTo}T00:00:00`).toLocaleDateString('en-IN') : 'Today'}`
    : 'All dates';

  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkAssign() {
    if (!assignTarget || selected.size === 0) return;
    await bulkAssign.mutateAsync({ leadIds: Array.from(selected), assignedTo: assignTarget });
    setSelected(new Set());
    setAssignTarget('');
  }

  async function downloadExport() {
    if (hasCampaignOptions && exportCampaigns.size === 0) return toast('Select at least one campaign', 'error');
    if (!selectedExportLeadCount) return toast('No leads match the selected filters', 'error');
    setExporting(true);
    try {
      const token = useAuthStore.getState().accessToken;
      const response = await fetch(`${API_URL}/leads/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ campaigns: Array.from(exportCampaigns), allFiltered: !hasCampaignOptions, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Export failed');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The export file was empty');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Errances-Leads-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 2000);
      setExportOpen(false);
      toast('Campaign leads exported', 'success');
    } catch (error: any) { toast(error.message || 'Export failed', 'error'); }
    finally { setExporting(false); }
  }

  async function importLeads(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const token = useAuthStore.getState().accessToken;
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API_URL}/leads/import`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Import failed');
      toast(`Import complete: ${result.profilesCreated} profiles created, ${result.enquiriesAdded} enquiries added`, 'success');
      window.location.reload();
    } catch (error: any) { toast(error.message || 'Import failed', 'error'); }
    finally { setImporting(false); }
  }

  const columns: ColumnDef<Lead>[] = [
    {
      id: 'serial',
      header: '#',
      // `leads` is now the accumulated (scrolled-so-far) list, not just the current page's slice
      // -- row.index is already the right position within it.
      cell: ({ row }) => <span className="text-xs font-semibold text-muted-foreground">{row.index + 1}</span>,
    },
    ...(canAssign && selectMode
      ? [
          {
            id: 'select',
            header: () => (
              <input
                type="checkbox"
                checked={leads.length > 0 && selected.size === leads.length}
                onChange={toggleAll}
                onClick={(e) => e.stopPropagation()}
              />
            ),
            cell: ({ row }: { row: { original: Lead } }) => (
              <input
                type="checkbox"
                checked={selected.has(row.original.id)}
                onChange={() => toggleOne(row.original.id)}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          } as ColumnDef<Lead>,
        ]
      : []),
    {
      accessorKey: 'lead_date',
      header: 'Date',
      cell: ({ row }) => { const at = new Date(row.original.lead_date || row.original.created_at || Date.now()); return <span className="whitespace-nowrap text-xs text-muted-foreground"><span className="font-medium text-foreground">{at.toLocaleDateString('en-IN')}</span><br />{at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>; },
    },
    { accessorKey: 'customer_name', header: 'Customer', cell: ({ getValue }) => { const name = String(getValue() || ''); const initials = name.split(/s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'; return <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold to-amber-500 text-[11px] font-bold text-navy shadow-sm">{initials}</span><span className="text-[13px] font-bold leading-tight tracking-tight text-navy dark:text-white">{name}</span></div>; } },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => <span className="whitespace-nowrap font-medium tabular-nums">{formatPhone(row.original.phone || row.original.whatsapp_number) || '—'}</span> },
    { accessorKey: 'destination', header: 'Destination', cell: ({ getValue }) => <span className="font-medium text-emerald-700 dark:text-emerald-400">{String(getValue() || '—')}</span> },
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => <span className="whitespace-nowrap rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium">{sourceLabel(row.original)}</span>,
    },
    {
      accessorKey: 'itinerary_status',
      header: () => <span title="Status of the automatic WhatsApp itinerary message">Auto WhatsApp</span>,
      cell: ({ getValue }) => {
        const status = String(getValue() || '');
        const style = status === 'read' ? 'bg-emerald-100 text-emerald-700' : status === 'delivered' ? 'bg-indigo-100 text-indigo-700'
          : status === 'sent' || status === 'accepted' ? 'bg-sky-100 text-sky-700' : status === 'unconfirmed' ? 'bg-orange-100 text-orange-700'
          : status === 'failed' ? 'bg-red-100 text-red-700'
          : status === 'test_mode_skipped' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700';
        const label = status === 'read' ? 'Viewed' : status === 'delivered' ? 'Delivered' : status === 'sent' || status === 'accepted' ? 'Sent'
          : status === 'unconfirmed' ? 'Unconfirmed' : status === 'failed' ? 'Failed' : status === 'test_mode_skipped' ? 'Test mode' : 'Not sent';
        const title = status === 'sent' || status === 'accepted' ? 'Meta accepted this send but has not yet confirmed delivery'
          : status === 'unconfirmed' ? "Meta never confirmed delivery -- we can't verify whether this reached the customer" : undefined;
        return <span title={title} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
      },
    },
    {
      accessorKey: 'last_reply_at',
      header: () => <span title="Has the customer written back on WhatsApp?">Replied</span>,
      cell: ({ getValue }) => {
        const at = getValue() as string | null | undefined;
        if (!at) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">No reply</span>;
        const mins = Math.floor((Date.now() - new Date(at).getTime()) / 60000);
        const ago = mins < 60 ? `${Math.max(mins, 1)}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
        return <span title={new Date(at).toLocaleString('en-IN')} className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Replied · {ago}</span>;
      },
    },
    {
      id: 'status_priority',
      header: 'Status',
      cell: ({ row }) => { const lead=row.original; return <div className="flex items-center gap-1.5">{canEdit ? <select aria-label={`Status for ${lead.customer_name}`} className="h-8 min-w-[9.5rem] rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700" value={lead.status} disabled={quickUpdate.isPending} onClick={(event)=>event.stopPropagation()} onChange={(event)=>{event.stopPropagation(); const nextStatus=event.target.value; if (needsReason(nextStatus) && nextStatus !== lead.status) { setReasonFor({ lead, status: nextStatus }); return; } quickUpdate.mutate({id:lead.id,input:{status:nextStatus}},{onSuccess:()=>{ const next = nextStatus !== lead.status ? stageDestination(nextStatus, lead) : null; toast(`Status changed to ${leadStatusLabel(nextStatus)}${next ? ` — now ${next.label}` : ''}`,'success'); if (next) router.push(next.href); },onError:(error:any)=>toast(error.message || 'Could not change status','error')});}}>{STATUS_GROUPS.map((g)=><optgroup key={g.key} label={g.label}>{g.statuses.map((status)=><option key={status.value} value={status.value}>{status.label}</option>)}</optgroup>)}</select> : <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{leadStatusLabel(lead.status)}</span>}{canEdit && needsReason(lead.status) && !String(lead.lost_reason ?? '').trim() && <button type="button" title="This lead was closed without a reason. Add it now." onClick={(event)=>{event.stopPropagation(); setReasonFor({ lead, status: lead.status });}} className="whitespace-nowrap rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 hover:bg-red-100">Add reason</button>}{lead.quality && <span title={`Lead quality: ${QUALITY_STYLE[lead.quality]?.label}`} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${QUALITY_STYLE[lead.quality]?.chip}`}>{QUALITY_STYLE[lead.quality]?.label}</span>}</div>; },
    },
    {
      accessorKey: 'assigned_to_name',
      header: 'Assigned To',
      cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || 'Unassigned'}</span>,
    },
    {
      id: 'actions',
      header: 'Quick Actions',
      cell: ({ row }) => { const lead=row.original; const phone=lead.whatsapp_number || lead.phone || ''; return <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}><button title="Call" disabled={!lead.phone} className="rounded-md p-2 text-navy hover:bg-navy/10 disabled:opacity-30 dark:text-gold" onClick={(event) => { event.stopPropagation(); if (lead.phone) window.location.href=`tel:${lead.phone}`; }}><Phone className="h-4 w-4" /></button><WhatsAppChoice leadId={lead.id} phone={phone} title="WhatsApp" className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-30"><MessageCircle className="h-4 w-4" /></WhatsAppChoice><button title="Open profile" className="rounded-md p-2 text-slate-600 hover:bg-muted" onClick={(event) => { event.stopPropagation(); router.push(`/leads/${lead.id}`); }}><Eye className="h-4 w-4" /></button></div>; },
    },
  ];

  return (
    <div className="space-y-5">
      <StatusGuide />
      <div className="flex items-center justify-end gap-2">
        {canAssign && <Button variant={selectMode ? 'gold' : 'outline'} onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}>{selectMode ? 'Done selecting' : 'Select leads'}</Button>}
        <PermissionGuard permission={PERMISSIONS.LEADS_CREATE}>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted"><Upload className="h-4 w-4" />{importing ? 'Importing…' : 'Import Excel'}<input type="file" accept=".xlsx" className="hidden" disabled={importing} onChange={importLeads} /></label>
        </PermissionGuard>
        <PermissionGuard permission={PERMISSIONS.LEADS_EXPORT}>
          <Button variant="outline" className="gap-2" onClick={() => { setExportCampaigns(new Set((campaigns ?? []).map((item) => item.campaign_name))); setExportOpen(true); }}><Download className="h-4 w-4" /> Export leads</Button>
        </PermissionGuard>
        <PermissionGuard permission={PERMISSIONS.LEADS_CREATE}>
          <Button variant="outline" onClick={() => router.push('/leads/not-interested')}>Not interested — reasons</Button>
          <Button variant="gold" onClick={() => setAddLeadOpen(true)}>+ New Lead</Button>
        </PermissionGuard>
      </div>
      {addLeadOpen && <AddLeadModal onClose={() => setAddLeadOpen(false)} />}

      {exportOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false); }}>
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><h2 className="text-lg font-bold text-navy dark:text-white">Export campaign leads</h2><p className="mt-1 text-sm text-muted-foreground">Each selected campaign gets its own sheet. Overall Leads contains all selected campaigns, newest first.</p></div><button onClick={() => setExportOpen(false)} className="rounded-lg p-2 hover:bg-muted"><X className="h-4 w-4" /></button></div>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto p-6">
              {hasCampaignOptions?<label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 font-semibold"><span className="flex items-center gap-3"><input type="checkbox" checked={exportCampaigns.size === campaigns?.length} onChange={(event) => setExportCampaigns(event.target.checked ? new Set((campaigns ?? []).map((item) => item.campaign_name)) : new Set())} /> Select all campaigns</span><span className="rounded-full bg-navy px-3 py-1 text-xs font-bold text-white">{selectedExportLeadCount.toLocaleString('en-IN')} leads</span></label>:<div className="flex items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/5 p-3"><div><p className="font-semibold">Export selected date range</p><p className="text-xs text-muted-foreground">{dateLabel} · includes leads without campaign names</p></div><span className="rounded-full bg-navy px-3 py-1 text-xs font-bold text-white">{selectedExportLeadCount.toLocaleString('en-IN')} leads</span></div>}
              {(campaigns ?? []).map((campaign) => <label key={campaign.campaign_name} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 hover:border-gold/50"><span className="flex items-center gap-3"><input type="checkbox" checked={exportCampaigns.has(campaign.campaign_name)} onChange={() => setExportCampaigns((previous) => { const next = new Set(previous); if (next.has(campaign.campaign_name)) next.delete(campaign.campaign_name); else next.add(campaign.campaign_name); return next; })} /><span className="text-sm font-medium">{campaign.campaign_name}</span></span><span className="rounded-full bg-gold/10 px-2 py-1 text-xs font-semibold text-gold-700">{campaign.lead_count}</span></label>)}
            </div>
            <div className="flex items-center justify-between border-t border-border px-6 py-4"><div><p className="text-sm font-semibold text-navy dark:text-white">{selectedExportLeadCount.toLocaleString('en-IN')} total leads</p><p className="text-xs text-muted-foreground">{hasCampaignOptions?`${exportCampaigns.size} campaign${exportCampaigns.size === 1 ? '' : 's'} selected`:'Selected date filter'}</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button><Button variant="gold" disabled={exporting || selectedExportLeadCount === 0 || (hasCampaignOptions&&exportCampaigns.size===0)} onClick={downloadExport}>{exporting ? 'Preparing…' : 'Download Excel'}</Button></div></div>
          </div>
        </div>
      )}

      <section className="flex flex-wrap items-center gap-7 rounded-2xl bg-gradient-to-r from-navy via-navy-900 to-navy-800 px-7 py-6 text-white shadow-lg ring-1 ring-gold/20">
        <div className="min-w-64 border-r border-gold/30 pr-8"><h1 className="text-2xl font-bold text-gold">Leads</h1><p className="mt-1 text-sm text-slate-300">Manage and track all your sales leads</p></div>
        {[['Total leads', stats?.total], ["Today's leads", stats?.today], ['New leads', stats?.new_leads], ['Hot / strong', stats?.hot], ['Unassigned', stats?.unassigned]].map(([label,value]) => <div key={String(label)}><p className="text-3xl font-bold text-white">{value ?? '—'}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-gold/80">{label}</p></div>)}
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Input
          placeholder="Search by name, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <CampaignFilterSelect value={campaignName} onChange={setCampaignName} campaigns={filterCampaigns} />
        <select className={selectClass} value={noPhone ? 'none' : 'all'} onChange={(e) => setNoPhone(e.target.value === 'none')}>
          <option value="all">All leads</option>
          <option value="none">No phone number</option>
        </select>
        <select className={selectClass} value={itineraryStatus} onChange={(e) => setItineraryStatus(e.target.value)} title="Filter by the automatic WhatsApp itinerary's status">
          <option value="">Auto WhatsApp: all</option>
          <option value="read">Viewed</option>
          <option value="delivered">Delivered</option>
          <option value="sent">Sent (not yet delivered)</option>
          <option value="unconfirmed">Unconfirmed — no reply from Meta</option>
          <option value="failed">Failed</option>
          <option value="none">Not sent yet</option>
        </select>
        <select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {canAssign && (
          <select className={selectClass} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">All (assigned + unassigned)</option>
            <option value="unassigned">Unassigned only</option>
            {(assignableUsers?.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        )}
        <div className="relative">
          <Button type="button" variant="outline" className="min-w-52 justify-start gap-2" onClick={() => setDateMenuOpen((open) => !open)}><CalendarDays className="h-4 w-4" />{dateLabel}</Button>
          {dateMenuOpen && <div className="absolute left-0 top-11 z-50 w-80 rounded-xl border border-border bg-card p-4 shadow-xl">
            <p className="mb-3 text-sm font-semibold text-navy dark:text-white">Select lead date</p>
            <div className="grid grid-cols-2 gap-2">
              {[['Today','today'],['Yesterday','yesterday'],['Last 7 days','7'],['Last 14 days','14'],['Last 30 days','30'],['This month','month']].map(([label,preset]) => <button key={preset} type="button" className="rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-gold hover:bg-gold/5" onClick={() => applyDatePreset(preset as any)}>{label}</button>)}
            </div>
            <div className="mt-4 border-t border-border pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom range</p><div className="grid grid-cols-2 gap-2"><Input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /><Input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div></div>
            <div className="mt-4 flex justify-between"><Button type="button" variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setDateMenuOpen(false); }}>Clear</Button><Button type="button" variant="gold" size="sm" onClick={() => setDateMenuOpen(false)}>Update</Button></div>
          </div>}
        </div>
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-navy dark:text-gold">
          {isLoading ? 'Counting leads…' : `${total.toLocaleString('en-IN')} lead${total === 1 ? '' : 's'} found`}
          {(dateFrom || dateTo) && <span className="ml-1 font-normal text-muted-foreground">for selected dates</span>}
        </div>
        <div className="ml-auto flex rounded-md border border-border bg-background p-1" aria-label="Lead view">
          <Button type="button" size="sm" variant={viewMode === 'table' ? 'gold' : 'ghost'} onClick={() => changeView('table')} className="gap-1.5">
            <Table2 className="h-4 w-4" /> Table
          </Button>
          <Button type="button" size="sm" variant={viewMode === 'board' ? 'gold' : 'ghost'} onClick={() => changeView('board')} className="gap-1.5">
            <Columns3 className="h-4 w-4" /> Board
          </Button>
          <Button type="button" size="sm" variant={viewMode === 'cards' ? 'gold' : 'ghost'} onClick={() => changeView('cards')} className="gap-1.5">
            <LayoutGrid className="h-4 w-4" /> Cards
          </Button>
        </div>
      </div>

      {campaignName && campaignSummary && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
          <span className="font-semibold text-navy dark:text-white">{campaignName}</span>
          <span className="text-muted-foreground">{campaignSummary.total} lead{campaignSummary.total === 1 ? '' : 's'}</span>
          <span className="font-semibold text-emerald-700">{campaignSummary.sent} itinerary sent</span>
          <span className="font-semibold text-amber-700">{campaignSummary.notSent} not sent</span>
        </div>
      )}

      {canAssign && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} lead{selected.size > 1 ? 's' : ''} selected</span>
          <select className={selectClass} value={assignTarget} onChange={(e) => setAssignTarget(e.target.value)}>
            <option value="">Assign to…</option>
            {(assignableUsers?.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
          <Button
            variant="gold"
            size="sm"
            disabled={!assignTarget || bulkAssign.isPending}
            onClick={handleBulkAssign}
          >
            {bulkAssign.isPending ? 'Assigning…' : 'Assign'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-500">
          Failed to load leads: {(error as Error)?.message ?? 'unknown error'}
        </p>
      )}

      {viewMode === 'table' ? (
        <DataTable
          columns={columns}
          data={leads}
          isLoading={isInitialLoading}
          stickyLastColumn
          stickyFirstColumn
          compact
          onRowClick={(row) => router.push(`/leads/${row.id}`)}
          emptyMessage="No leads match the selected filters."
        />
      ) : viewMode === 'cards' ? (isInitialLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({length:6}).map((_,i)=><div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />)}</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{leads.map((lead)=><article key={lead.id} onClick={()=>router.push(`/leads/${lead.id}`)} className="cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-gold/60 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-navy dark:text-white">{lead.customer_name}</p><p className="mt-1 text-xs text-muted-foreground">{formatPhone(lead.phone || lead.whatsapp_number) || 'No phone'}</p></div><span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-700">{leadStatusLabel(lead.status)}</span></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs"><div><p className="text-muted-foreground">Destination</p><p className="mt-1 font-medium">{lead.destination || '—'}</p></div><div><p className="text-muted-foreground">Source</p><p className="mt-1 font-medium capitalize">{(lead.source || '—').replace(/_/g,' ')}</p></div><div><p className="text-muted-foreground">Created</p><p className="mt-1 font-medium">{new Date(lead.lead_date || lead.created_at).toLocaleDateString('en-IN')}</p></div><div><p className="text-muted-foreground">Assigned</p><p className="mt-1 font-medium">{lead.assigned_to_name || 'Unassigned'}</p></div></div></article>)}</div>) : isLoading ? (
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-96 min-w-72 animate-pulse rounded-xl border bg-muted" />)}
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">No leads match the selected filters.</div>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max gap-4">
            {LEAD_STATUSES.map((stage) => {
              const columnLeads = leads.filter((lead) => lead.status === stage.value);
              return (
                <section key={stage.value} className="w-72 rounded-xl border border-border bg-muted/35">
                  <header className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-navy dark:text-white">{stage.label}</h2>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">{columnLeads.length}</span>
                  </header>
                  <div className="max-h-[64vh] space-y-2 overflow-y-auto p-2">
                    {columnLeads.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">No leads</p>}
                    {columnLeads.map((lead) => (
                      <article key={lead.id} className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-gold/60 hover:shadow" onClick={() => router.push(`/leads/${lead.id}`)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-navy dark:text-white">{lead.customer_name}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{lead.lead_number}</p>
                          </div>
                          {canAssign && <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleOne(lead.id)} onClick={(event) => event.stopPropagation()} />}
                        </div>
                        <div className="mt-3 space-y-1.5 text-xs">
                          <p><span className="text-muted-foreground">Phone:</span> {lead.phone || lead.whatsapp_number || '—'}</p>
                          <p><span className="text-muted-foreground">Tour:</span> {lead.destination || '—'}</p>
                          <p className="line-clamp-2"><span className="text-muted-foreground">Campaign:</span> {lead.campaign_name || '—'}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-end border-t border-border pt-2 text-[11px]">
                          <span className="max-w-32 truncate text-muted-foreground">{lead.assigned_to_name || 'Unassigned'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {viewMode !== 'board' && (
        <div className="flex flex-col items-center gap-2 py-2">
          <p className="text-sm text-muted-foreground">Showing <span className="font-semibold text-foreground">{leads.length}</span> of <span className="font-semibold text-foreground">{total}</span> leads</p>
          {/* Invisible trigger -- scrolling this into view loads the next page automatically.
              `rootMargin: '400px'` on the observer fires it a bit before it's actually visible, so
              the next page is usually already loading by the time someone reaches the bottom. */}
          {page < totalPages && <div ref={sentinelRef} className="h-4 w-full" />}
          {isLoading && page > 1 && <p className="text-xs text-muted-foreground">Loading more…</p>}
          {page >= totalPages && total > 0 && <p className="text-xs text-muted-foreground">You've reached the end.</p>}
        </div>
      )}
      {reasonFor && <ReasonDialog adding={reasonFor.status === reasonFor.lead.status} leadName={reasonFor.lead.customer_name} status={reasonFor.status} saving={quickUpdate.isPending} onCancel={() => setReasonFor(null)} onConfirm={(reason) => quickUpdate.mutate({ id: reasonFor.lead.id, input: { status: reasonFor.status, lostReason: reason } }, { onSuccess: () => { toast(reasonFor.status === reasonFor.lead.status ? 'Reason saved in the Not interested list' : `Status changed to ${leadStatusLabel(reasonFor.status)} — reason saved in the Not interested list`, 'success'); setReasonFor(null); }, onError: (error: any) => toast(error.message || 'Could not change status', 'error') })} />}
    </div>
  );
}
