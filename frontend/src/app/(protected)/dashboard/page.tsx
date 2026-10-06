'use client';
import { useMyAccess } from '@/hooks/use-access';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, FileText, RefreshCw, Users, WalletCards } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { Lead } from '@/types/lead';
import { Task } from '@/types/task';
import { Quotation } from '@/types/quotation';
import { useCampaignCoverage } from '@/hooks/use-packages';
import { useAllFollowUps } from '@/hooks/use-follow-ups';
import { FailedWhatsAppPanel } from '@/components/dashboard/failed-whatsapp-panel';
import { useCallbackRequests } from '@/hooks/use-callback-requests';
import { useWhatsAppBilling } from '@/hooks/use-whatsapp';
import { locale, tr } from '@/i18n';

const GAP_REASON: Record<string,string> = { no_itinerary_mapped: 'No itinerary uploaded/mapped', template_not_approved: 'Template not yet Meta-approved', itinerary_inactive: 'Itinerary uploaded but turned off' };

type List<T>={data:T[];total:number};
type AdAccountSummary={connected:boolean;accountId?:string;accountName?:string;accountStatus?:number;currency?:string;balance?:number;amountSpent?:number;spendCap?:number;todaySpend?:number;todayImpressions?:number;todayClicks?:number;warningLevel?:'healthy'|'low'|'critical';updatedAt?:string;message?:string};
const day=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const isToday=(value?:string|null)=>!!value&&day(new Date(value))===day();

function Panel({title,count,href,icon:Icon,children}:{title:string;count:number;href:string;icon:React.ElementType;children:React.ReactNode}) {
 return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><header className="flex items-center justify-between border-b px-5 py-4"><div className="flex items-center gap-2"><span className="rounded-lg bg-gold/15 p-2 text-gold"><Icon className="h-4 w-4"/></span><h2 className="font-semibold">{tr(title)}</h2><b className="rounded-full bg-gold px-2 py-0.5 text-xs text-navy">{count}</b></div><Link href={href} className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-gold">{tr('All')} <ArrowRight className="h-3.5 w-3.5"/></Link></header><div className="divide-y"><div className="max-h-[24rem] overflow-y-auto">{children}</div></div></section>;
}

export default function DashboardPage(){ const user=useAuthStore(s=>s.user), today=day();
 // Each section only loads (and only renders) if switched on for this login -- a hidden section never
 // fetches its data at all, so e.g. the ad balance never reaches a browser that is not allowed it.
 const {can}=useMyAccess();
 const lq=useQuery({queryKey:['dash','leads',today],queryFn:()=>api.get<List<Lead>>(`/leads?dateFrom=${today}&dateTo=${today}&pageSize=6`),enabled:can('dashboard.new_leads')});
 const tq=useQuery({queryKey:['dash','tasks',today],queryFn:()=>api.get<List<Task>>('/tasks?pageSize=100')});
 const qq=useQuery({queryKey:['dash','quotes',today],queryFn:()=>api.get<List<Quotation>>('/quotations?pageSize=100'),enabled:can('dashboard.quotations')});
 const aq=useQuery({
  queryKey:['dash','meta-ad-balance'],
  queryFn:()=>api.get<AdAccountSummary>('/integrations/meta/ad-account-summary'),
  enabled:can('dashboard.meta_ads'),
  refetchInterval:30*1000,
  refetchIntervalInBackground:true,
  refetchOnWindowFocus:true,
 });
 const leads=lq.data?.data??[];
 const fuOverdue=useAllFollowUps({status:'overdue'},{enabled:can('dashboard.calls')}), fuToday=useAllFollowUps({status:'today'},{enabled:can('dashboard.calls')});
 const due=fuToday.data?.data??[];
 const overdue=fuOverdue.data?.data??[];
 const followups=[...overdue,...due].slice(0,6);
 const quotes=(qq.data?.data??[]).filter(q=>isToday(q.created_at));
 const cq=useCampaignCoverage({enabled:can('dashboard.coverage')});
 const bill=useWhatsAppBilling({enabled:can('dashboard.wa_billing')});
 const inr=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n);
 const cbq=useCallbackRequests({enabled:can('dashboard.calls')});
 const pendingCallbacks=(cbq.data?.data??[]).filter(c=>!c.called_at);
 const ads=aq.data;
 const coverage=cq.data;
 const gapCount=coverage?.gaps.length??0;
 const money=(value?:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:ads?.currency||'INR',maximumFractionDigits:2}).format(value||0);
 return <div className="space-y-6">
  <section className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-gradient-to-r from-navy via-navy-900 to-navy-800 px-7 py-7 text-white shadow-lg ring-1 ring-gold/20"><div><h1 className="text-2xl font-bold text-gold">{tr('Good morning, {name}',{name:user?.fullName?.split(' ')[0]||tr('Team')})} 👋</h1><p className="mt-1 text-sm text-slate-300">{new Date().toLocaleDateString(locale(),{day:'numeric',month:'long',year:'numeric'})}</p></div><div className="flex flex-wrap gap-8">{([['dashboard.calls','Calls & follow-ups',pendingCallbacks.length+due.length+overdue.length],['dashboard.new_leads','New leads today',lq.data?.total??0],['dashboard.quotations','Quotations today',quotes.length]] as [string,string,number][]).filter(([k])=>can(k)).map(([,label,value])=>[label,value] as const).map(([label,value])=><div key={String(label)}><p className="text-3xl font-bold">{value}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-gold/80">{tr(label)}</p></div>)}</div></section>
  <div className="grid items-start gap-4 lg:grid-cols-2">
  {can('dashboard.meta_ads')&&<section className={`rounded-2xl border p-5 shadow-sm ${ads?.warningLevel==='critical'?'border-red-300 bg-red-50':ads?.warningLevel==='low'?'border-amber-300 bg-amber-50':'border-border bg-card'}`}>
   <div className="flex flex-wrap items-start justify-between gap-5">
    <div className="flex items-center gap-3"><span className="rounded-xl bg-gold/15 p-3 text-gold"><WalletCards className="h-5 w-5"/></span><div><div className="flex items-center gap-2"><h2 className="font-semibold">{tr('Meta Ads balance')}</h2>{ads?.warningLevel!=='healthy'&&ads?.connected?<AlertTriangle className={`h-4 w-4 ${ads.warningLevel==='critical'?'text-red-600':'text-amber-600'}`}/>:null}</div><p className="text-xs text-muted-foreground">{ads?.accountName||'Errances Voyages'} · {tr('Live Ads Manager data')}</p></div></div>
    <button type="button" onClick={()=>aq.refetch()} disabled={aq.isFetching} className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${aq.isFetching?'animate-spin':''}`}/>{tr('Refresh')}</button>
   </div>
   {ads?.connected?<div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><div><p className={`text-2xl font-bold ${ads.warningLevel==='critical'?'text-red-700':ads.warningLevel==='low'?'text-amber-700':'text-emerald-700'}`}>{money(ads.balance)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Available balance')}</p></div><div><p className="text-xl font-bold">{money(ads.todaySpend)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Spent today')}</p></div><div><p className="text-xl font-bold">{money(ads.amountSpent)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Total spent')}</p></div><div><p className="text-xl font-bold">{Number(ads.todayClicks||0).toLocaleString('en-IN')}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Clicks today')}</p></div><div><p className="text-xl font-bold">{Number(ads.todayImpressions||0).toLocaleString('en-IN')}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Impressions today')}</p></div></div>:<p className="mt-5 text-sm text-red-600">{aq.isLoading?tr('Checking Ads Manager…'):tr(ads?.message||'Meta Ads balance is unavailable.')}</p>}
   {ads?.connected&&ads.warningLevel!=='healthy'?<div className={`mt-4 rounded-lg px-3 py-3 text-sm font-semibold ${ads.warningLevel==='critical'?'bg-red-100 text-red-800':'bg-amber-100 text-amber-800'}`}>
     <p>{ads.warningLevel==='critical'?tr('Meta Ads balance is ₹500 or lower. Recharge now to prevent ads from stopping.'):tr('Meta Ads balance is below ₹1,000. Plan a recharge soon.')}</p>
     <p className="mt-1 text-xs font-normal opacity-90">{tr('Account to top up:')} <b>{ads.accountName}</b> ({ads.accountId})</p>
     <a href={`https://www.facebook.com/ads/manager/account_settings/account_billing/?act=${(ads.accountId||'').replace('act_','')}`} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-900">{tr('Open Meta Billing to recharge')}</a>
    </div>:null}
   </section>}
   {can('dashboard.wa_billing')&&bill.data&&<section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-gold/15 p-3 text-gold"><WalletCards className="h-5 w-5"/></span><div><h2 className="font-semibold">{tr('WhatsApp billing — this month')}</h2><p className="text-xs text-muted-foreground">{tr('Live from Meta · updates every few minutes')}</p></div></div><button type="button" onClick={()=>bill.refetch()} disabled={bill.isFetching} className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${bill.isFetching?'animate-spin':''}`}/>{tr('Refresh')}</button></div><div className="mt-4 grid grid-cols-2 gap-4"><div><p className="text-2xl font-bold">{inr(bill.data.totalCost)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Usage so far')}</p></div><div><p className="text-xl font-bold">{inr(bill.data.todayCost)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Latest day')}</p></div><div><p className="text-xl font-bold">{inr(bill.data.estimatedGst)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('GST @ {rate}% (est.)',{rate:Math.round(bill.data.gstRate*100)})}</p></div><div><p className="text-xl font-bold text-amber-700">{inr(bill.data.estimatedTotal)}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Estimated total')}</p></div></div><div className="mt-4 divide-y rounded-lg border text-sm">{bill.data.byCategory.map(c=><div key={c.category} className="flex justify-between px-3 py-2"><span className="capitalize">{c.category.toLowerCase()} · {c.volume.toLocaleString('en-IN')} {tr('msgs')}</span><b>{inr(c.cost)}</b></div>)}</div><p className="mt-3 text-xs text-muted-foreground">{tr("Usage is Meta's own count. Tax is our estimate; the exact amount and payment happen in Meta Billing Hub, which can differ by the last day or two of usage.")}</p></section>}
  {can('dashboard.coverage')&&<section className={`rounded-2xl border p-5 shadow-sm ${gapCount>0?'border-red-300 bg-red-50':'border-border bg-card'}`}>
   <div className="flex flex-wrap items-start justify-between gap-5">
    <div className="flex items-center gap-3"><span className="rounded-xl bg-gold/15 p-3 text-gold"><FileText className="h-5 w-5"/></span><div><div className="flex items-center gap-2"><h2 className="font-semibold">{tr('Ad campaign → itinerary coverage')}</h2>{gapCount>0&&<AlertTriangle className="h-4 w-4 text-red-600"/>}</div><p className="text-xs text-muted-foreground">{tr('Every live Meta campaign checked against its itinerary, automatically')}</p></div></div>
    <Link href="/packages" className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-semibold hover:bg-muted">{tr('Open Packages')} <ArrowRight className="h-3.5 w-3.5"/></Link>
   </div>
   {cq.isLoading?<p className="mt-4 text-sm text-muted-foreground">{tr('Checking campaigns…')}</p>
    :coverage?<>
      <p className={`mt-4 text-sm font-semibold ${gapCount>0?'text-red-700':'text-emerald-700'}`}>{tr('{covered} of {total} active ad campaigns have a ready, active itinerary',{covered:coverage.covered,total:coverage.activeCampaigns})}{gapCount>0?tr(' — {n} do not',{n:gapCount}):''}</p>
      {gapCount>0&&<div className="mt-3 divide-y rounded-lg border border-red-200 bg-white">{coverage.gaps.map(g=><div key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5"><div><p className="text-sm font-semibold text-navy">{g.name}</p><p className="text-xs text-red-600">{tr(GAP_REASON[g.reason])}</p></div><Link href="/packages" className="shrink-0 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-navy">{tr('Fix')}</Link></div>)}</div>}
    </>
    :<p className="mt-4 text-sm text-muted-foreground">{tr('Coverage check unavailable.')}</p>}
   </section>}
  </div>
  <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
   {can('dashboard.failed')&&<FailedWhatsAppPanel />}
   {can('dashboard.calls')&&<Panel title="Calls & follow-ups" count={pendingCallbacks.length+due.length+overdue.length} href="/followups" icon={CalendarClock}>{pendingCallbacks.length+followups.length?<>{pendingCallbacks.slice(0,4).map(c=><Link href="/followups" key={c.id} className="block bg-red-50/60 px-5 py-3.5 hover:bg-muted/40"><div className="flex justify-between gap-3"><div><p className="text-sm font-semibold">{c.customer_name}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{c.phone} · {tr('asked for a call')} {new Date(c.requested_at).toLocaleString(locale(),{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</p></div><span className="h-fit rounded-full bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700">{tr('Call back')}</span></div></Link>)}{followups.map(t=>{const late=new Date(t.due_at).toDateString()!==new Date().toDateString()&&new Date(t.due_at)<new Date();return <Link href={`/leads/${t.lead_id}?tab=followup`} key={t.id} className={`block px-5 py-3.5 hover:bg-muted/40 ${late?'bg-red-50/60':''}`}><div className="flex justify-between gap-3"><div><p className="text-sm font-semibold">{t.customer_name||tr('Lead')}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{t.note||tr('Lead follow-up')} · {new Date(t.due_at).toLocaleString(locale(),{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</p></div><span className={`h-fit rounded-full px-2 py-1 text-[11px] font-semibold ${late?'bg-red-100 text-red-700':'bg-gold/15 text-gold-600'}`}>{late?tr('Overdue'):tr('Today')}</span></div></Link>})}</>:<p className="px-5 py-10 text-center text-sm text-muted-foreground">{tr('Nothing waiting — no callbacks or follow-ups due.')}</p>}</Panel>}
   {can('dashboard.new_leads')&&<Panel title="New Leads" count={lq.data?.total??0} href="/leads" icon={Users}>{leads.length?leads.map(l=><Link href={`/leads/${l.id}`} key={l.id} className="flex justify-between gap-3 px-5 py-3.5 hover:bg-muted/40"><div><p className="text-sm font-semibold">{l.customer_name}</p><p className="mt-1 text-xs text-muted-foreground">{l.destination||l.lead_number}</p></div><span className="h-fit rounded-full bg-blue-100 px-2 py-1 text-[11px] font-semibold capitalize text-blue-700">{tr(l.status.replace(/_/g,' '))}</span></Link>):<p className="px-5 py-10 text-center text-sm text-muted-foreground">{tr('No new leads today.')}</p>}</Panel>}
   {can('dashboard.quotations')&&<Panel title="Quotations" count={quotes.length} href="/quotations" icon={FileText}>{quotes.length?quotes.slice(0,6).map(q=><Link href={`/quotations/${q.id}`} key={q.id} className="flex justify-between gap-3 px-5 py-3.5 hover:bg-muted/40"><div><p className="text-sm font-semibold">{q.lead_customer_name||q.customer_name||q.quotation_number}</p><p className="mt-1 text-xs text-muted-foreground">{q.quotation_number} · {q.destination||tr('Tour')}</p></div><div className="text-right"><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold capitalize">{tr(q.status)}</span><p className="mt-1 text-xs font-semibold">₹{Number(q.final_amount||0).toLocaleString('en-IN')}</p></div></Link>):<p className="px-5 py-10 text-center text-sm text-muted-foreground">{tr('No quotations today.')}</p>}</Panel>}
  </div>
 </div>;
}
