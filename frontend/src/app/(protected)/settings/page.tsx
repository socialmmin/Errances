'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Bell,BellOff,Building2,CheckCircle2,Cloud,Eye,EyeOff,Image as ImageIcon,KeyRound,MessageSquareText,Plus,ShieldCheck,Trash2,Users} from 'lucide-react';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api-client';
import {useAuthStore} from '@/store/auth-store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useToast} from '@/components/ui/toast';
import {useDailyReportPreview,useDailyReportSettings,useSaveDailyReportSettings,useSendDailyReportNow,useSubmitDailyReportTemplate,useSyncDailyReportTemplate} from '@/hooks/use-daily-report';
import { tr } from '@/i18n';
const API_URL=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api';
type Tab='company'|'users'|'api'|'notifications'|'dailyreport'; type Company=Record<string,any>;
const identity=[['companyName','Company name'],['legalName','Legal name'],['tagline','Tagline'],['phone','Company phone'],['email','Company email'],['website','Website'],['gstin','GSTIN'],['address','Office address']];
const bank=[['bankName','Bank name'],['bankAccountName','Account holder'],['bankAccountNumber','Account number'],['bankIfsc','IFSC code'],['bankBranch','Bank branch'],['upiId','UPI ID']];
export default function SettingsPage(){
 const {toast}=useToast();const token=useAuthStore(s=>s.accessToken);const user=useAuthStore(s=>s.user);const [tab,setTab]=useState<Tab>('company');const [reveal,setReveal]=useState(false);
 const {data}=useQuery({queryKey:['company-settings'],queryFn:()=>api.get<Company>('/settings/company')});
 const {data:users}=useQuery({queryKey:['settings-users-summary'],queryFn:()=>api.get<{data:any[];total:number}>('/users')});
 const {data:integrations,isFetching:loadingKeys}=useQuery({queryKey:['integration-status',reveal],queryFn:()=>api.get<{data:any[]}>(`/settings/company/integrations?reveal=${reveal}`)});
 const [form,setForm]=useState<Record<string,string>>({});const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState('');
 const {data:notifPref,refetch:refetchNotifPref}=useQuery({queryKey:['my-notification-preference'],queryFn:()=>api.get<{enabled:boolean}>('/users/me/notifications')});
 const [notifSaving,setNotifSaving]=useState(false);
 async function toggleNotifications(next:boolean){setNotifSaving(true);try{await api.patch('/users/me/notifications',{enabled:next});await refetchNotifPref();toast(next?tr("Notifications enabled"):tr("Notifications disabled — you will not receive push alerts for new leads, callbacks or itinerary sends"),'success')}catch(e:any){toast(tr(e.message),'error')}finally{setNotifSaving(false)}}
 useEffect(()=>{if(data)setForm({companyName:data.company_name||'',legalName:data.legal_name||'',tagline:data.tagline||'',logoUrl:data.logo_url||'',logoObjectKey:data.logo_object_key||'',faviconUrl:data.favicon_url||'',faviconObjectKey:data.favicon_object_key||'',phone:data.phone||'',email:data.email||'',website:data.website||'',address:data.address||'',gstin:data.gstin||'',bankName:data.bank_name||'',bankAccountName:data.bank_account_name||'',bankAccountNumber:data.bank_account_number||'',bankIfsc:data.bank_ifsc||'',bankBranch:data.bank_branch||'',upiId:data.upi_id||''});},[data]);
 async function upload(file:File,type:'logo'|'favicon'){setUploading(type);try{const body=new FormData();body.append('file',file);body.append('folder','company-branding');const res=await fetch(`${API_URL}/files/upload`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body});if(!res.ok)throw new Error('Upload failed');const v=await res.json();setForm(x=>({...x,[type==='logo'?'logoUrl':'faviconUrl']:v.url,[type==='logo'?'logoObjectKey':'faviconObjectKey']:v.objectKey}));toast(tr("Image uploaded. Save profile to apply."),'success');}catch(e:any){toast(tr(e.message),'error')}finally{setUploading('')}}
 async function save(){setSaving(true);try{await api.patch('/settings/company',form);toast(tr("Company profile saved"),'success');setTimeout(()=>location.reload(),500)}catch(e:any){toast(tr(e.message),'error')}finally{setSaving(false)}}
 const tabs=[{id:'company' as Tab,label:'Company profile',icon:Building2},{id:'notifications' as Tab,label:'Notifications',icon:Bell},{id:'dailyreport' as Tab,label:'Daily WhatsApp Report',icon:MessageSquareText},{id:'users' as Tab,label:'Company users',icon:Users},{id:'api' as Tab,label:'API integrations',icon:KeyRound}];
 return <div className="mx-auto max-w-7xl space-y-5 pb-10"><div><h1 className="text-3xl font-bold text-navy dark:text-white">{tr("Settings")}</h1><p className="mt-1 text-sm text-muted-foreground">{tr("Manage your company, team and connected services.")}</p></div><div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]"><aside className="h-fit rounded-2xl border bg-white p-2 shadow-sm">{tabs.map(({id,label,icon:Icon})=><button key={id} onClick={()=>setTab(id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold ${tab===id?'bg-navy text-white shadow':'text-slate-600 hover:bg-slate-50'}`}><Icon className={`h-4 w-4 ${tab===id?'text-gold':''}`}/>{tr(label)}</button>)}</aside><main>
 {tab==='company'&&<div className="space-y-5"><section className="rounded-2xl border bg-white p-6 shadow-sm"><div><h2 className="text-xl font-bold text-navy">{tr("Brand identity")}</h2><p className="text-sm text-slate-500">{tr("Used across login, navigation, browser tab and documents.")}</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Brand label={tr("Company logo")} value={form.logoUrl} busy={uploading==='logo'} onFile={f=>upload(f,'logo')}/><Brand label={tr("Browser tab icon")} value={form.faviconUrl} busy={uploading==='favicon'} onFile={f=>upload(f,'favicon')}/></div></section><Fields title={tr("Company details")} fields={identity} form={form} setForm={setForm}/><Fields title={tr("Bank details")} fields={bank} form={form} setForm={setForm}/><div className="flex justify-end"><Button variant="gold" onClick={save} disabled={saving}>{saving?tr("Saving…"):tr("Save company profile")}</Button></div></div>}
 {tab==='notifications'&&<div className="space-y-5"><section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-bold text-navy">{tr("Push notifications")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Turn off if you don't want new leads, callback requests or itinerary-sent alerts popping up on this account. This is separate from your browser's own notification permission.")}</p><div className={`mt-5 flex items-center justify-between rounded-xl border p-5 ${notifPref?.enabled!==false?'border-emerald-200 bg-emerald-50':'border-slate-200 bg-slate-50'}`}><div className="flex items-center gap-3">{notifPref?.enabled!==false?<Bell className="h-5 w-5 text-emerald-600"/>:<BellOff className="h-5 w-5 text-slate-400"/>}<div><p className="font-bold text-navy">{notifPref?.enabled!==false?tr("Notifications are ON"):tr("Notifications are OFF")}</p><p className="text-xs text-slate-500">{tr("New leads, \"request a call back\" taps, and itinerary-sent confirmations.")}</p></div></div><button type="button" disabled={notifSaving} onClick={()=>toggleNotifications(!(notifPref?.enabled!==false))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${notifPref?.enabled!==false?'bg-gold':'bg-slate-300'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifPref?.enabled!==false?'translate-x-6':'translate-x-1'}`}/></button></div></section></div>}
 {tab==='dailyreport'&&<DailyReportPanel/>}
 {tab==='users'&&<div className="space-y-5"><section className="rounded-2xl border bg-gradient-to-br from-navy to-slate-900 p-6 text-white shadow-xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Team access")}</p><h2 className="mt-2 text-2xl font-bold">{tr("Company users")}</h2><p className="mt-2 max-w-xl text-sm text-slate-300">{tr("Create employees, control round-robin participation and manage roles.")}</p></div><Link href="/settings/users"><Button variant="gold">{tr("Manage users")}</Button></Link></div></section><section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid grid-cols-[1.3fr_1fr_1fr_auto] border-b bg-slate-50 px-5 py-3 text-xs font-bold uppercase text-slate-500"><span>{tr("User")}</span><span>{tr("Role")}</span><span>{tr("Mobile")}</span><span>{tr("Status")}</span></div>{(users?.data||[]).map(item=><div key={item.id} className="grid grid-cols-[1.3fr_1fr_1fr_auto] items-center border-b px-5 py-4 text-sm"><div><p className="font-semibold text-navy">{item.full_name}</p><p className="text-xs text-slate-400">{item.email}</p></div><span className="capitalize">{tr(String(item.role_name||'—').replace(/_/g,' '))}</span><span>{item.phone||'—'}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.is_active?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{item.is_active?tr("Active"):tr("Inactive")}</span></div>)}</section></div>}
 {tab==='api'&&<div className="space-y-5"><section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-navy">{tr("API integrations")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Connection IDs and keys used by the CRM.")}</p></div><Button variant="outline" onClick={()=>setReveal(v=>!v)} disabled={loadingKeys}>{reveal?<EyeOff className="mr-2 h-4 w-4"/>:<Eye className="mr-2 h-4 w-4"/>}{reveal?tr("Hide keys"):tr("Show keys")}</Button></div><div className="mt-6 grid gap-4 xl:grid-cols-2">{(integrations?.data||[]).map(item=><article key={item.key} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between"><div className="flex gap-3"><span className="rounded-xl bg-gold/15 p-2.5 text-gold"><Cloud className="h-5 w-5"/></span><div><h3 className="font-bold text-navy">{item.name}</h3><p className="text-xs text-slate-500">{item.purpose}</p></div></div><span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${item.configured?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}><CheckCircle2 className="h-3.5 w-3.5"/>{item.configured?tr("Connected"):tr("Setup needed")}</span></div><div className="mt-4 space-y-2">{(item.fields||[]).map((field:any)=><div key={field.label} className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{tr(field.label)}</p><p className="mt-1 break-all font-mono text-xs text-slate-700">{field.value||tr("Not configured")}</p></div>)}</div><div className="mt-4 flex justify-end">{item.editHref?<Link href={item.editHref}><Button size="sm" variant="outline">{tr("Replace configuration")}</Button></Link>:<span className="text-xs text-slate-400">{tr("Server-managed credential")}</span>}</div></article>)}</div></section><p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"><ShieldCheck className="mr-2 inline h-4 w-4"/>{tr("Keys are visible only to authorised super admins. WhatsApp credentials can be replaced here; server-managed Meta, storage and push keys are displayed for verification.")}</p></div>}
 </main></div></div>;
}
function Fields({title,fields,form,setForm}:{title:string;fields:string[][];form:Record<string,string>;setForm:any}){return <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-navy">{tr(title)}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{fields.map(([key,label])=><div key={key} className={key==='address'?'sm:col-span-2':''}><Label>{tr(label)}</Label><Input className="mt-1.5" value={form[key]||''} onChange={e=>setForm((v:any)=>({...v,[key]:e.target.value}))}/></div>)}</div></section>}
function Brand({label,value,busy,onFile}:{label:string;value?:string;busy:boolean;onFile:(f:File)=>void}){return <div className="flex items-center gap-4 rounded-xl border p-4">{value?<img src={value} alt="" className="h-16 w-16 rounded-xl border object-contain"/>:<div className="grid h-16 w-16 place-items-center rounded-xl bg-slate-100"><ImageIcon className="h-6 w-6 text-slate-400"/></div>}<div><p className="text-sm font-semibold">{tr(label)}</p><label className="mt-2 inline-block cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50">{busy?tr("Uploading…"):tr("Replace image")}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={e=>e.target.files?.[0]&&onFile(e.target.files[0])}/></label></div></div>}

const SECTIONS = [
  { key: 'leadsToday', label: 'Leads', hint: 'New leads today' },
  { key: 'followUps', label: 'Follow-ups', hint: 'Pending / Total' },
  { key: 'callbacks', label: 'Callback Requests', hint: 'Pending / Total' },
  { key: 'failedWhatsapp', label: 'Failed WhatsApp', hint: 'Needing attention' },
  { key: 'itinerary', label: 'Packages & Itinerary', hint: 'Active campaigns / Not mapped' },
  { key: 'quotations', label: 'Quotations', hint: 'Sent / Draft' },
  { key: 'inbox', label: 'WhatsApp Inbox', hint: 'Unread chats' },
  { key: 'finance', label: 'Finance', hint: 'Collected today / Outstanding / Overdue' },
  { key: 'meta', label: 'Meta Quality', hint: 'Sent to Meta / Confirmed' },
];

const TEMPLATE_STYLE: Record<string, { label: string; chip: string }> = {
  APPROVED: { label: 'Approved', chip: 'bg-emerald-100 text-emerald-700' },
  PENDING: { label: 'Pending Meta review', chip: 'bg-amber-100 text-amber-700' },
  REJECTED: { label: 'Rejected', chip: 'bg-red-100 text-red-700' },
  PAUSED: { label: 'Paused', chip: 'bg-slate-100 text-slate-600' },
  DISABLED: { label: 'Disabled', chip: 'bg-slate-100 text-slate-600' },
};

function DailyReportPanel() {
  const { toast } = useToast();
  const { data: settings } = useDailyReportSettings();
  const { data: preview } = useDailyReportPreview();
  const save = useSaveDailyReportSettings();
  const submitTemplate = useSubmitDailyReportTemplate();
  const syncTemplate = useSyncDailyReportTemplate();
  const sendNow = useSendDailyReportNow();
  const [numbers, setNumbers] = useState<string[]>([]);
  const [newNumber, setNewNumber] = useState('');
  const [hour, setHour] = useState(20);
  const [minute, setMinute] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  if (settings && !loadedOnce) {
    setNumbers(settings.phoneNumbers);
    setHour(settings.sendHour);
    setMinute(settings.sendMinute);
    setEnabled(settings.enabled);
    setLoadedOnce(true);
  }

  const status = settings?.templateStatus ? TEMPLATE_STYLE[settings.templateStatus] : null;

  async function doSave() {
    try {
      await save.mutateAsync({ phoneNumbers: numbers, sendHour: hour, sendMinute: minute, enabled });
      toast(tr("Daily report settings saved"), 'success');
    } catch (e: any) { toast(e.message || tr("Could not save"), 'error'); }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-navy to-slate-900 p-6 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Owner reporting")}</p>
        <h2 className="mt-2 text-2xl font-bold">{tr("Daily WhatsApp Report")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">{tr("Sends once a day, at the time you choose, to the number(s) you add below. Every number in it is pulled live from that section's own real data at send time — nothing cached, nothing assumed.")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SECTIONS.map((s) => <span key={s.key} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold">{tr(s.label)}</span>)}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-navy">{tr("1. Who gets it, and when")}</h3>
        <div className="mt-4 space-y-2">
          <Label>{tr("WhatsApp numbers")}</Label>
          {numbers.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={n} readOnly className="bg-slate-50" />
              <button type="button" onClick={() => setNumbers((list) => list.filter((_, j) => j !== i))} className="rounded-lg p-2 text-red-500 hover:bg-red-50" aria-label={tr("Remove")}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="e.g. 9999999999" />
            <button type="button" onClick={() => { if (newNumber.trim()) { setNumbers((list) => [...list, newNumber.trim()]); setNewNumber(''); } }} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />{tr("Add")}</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <Label>{tr("Send time (IST)")}</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}</select>
              <span>:</span>
              <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">{[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}</select>
            </div>
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm font-semibold">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            {tr("Enabled (send automatically once a day)")}
          </label>
          <Button variant="gold" onClick={doSave} disabled={save.isPending} className="ml-auto">{save.isPending ? tr("Saving…") : tr("Save settings")}</Button>
        </div>
        {settings?.lastSentDate && <p className="mt-2 text-xs text-slate-400">{tr("Last sent:")}{' '}{settings.lastSentDate}</p>}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-navy">{tr("2. Template approval (required by WhatsApp)")}</h3>
        <p className="mt-1 text-sm text-slate-500">{tr("Same process as your itinerary templates: submit once, Meta reviews it, and once approved the daily send goes out automatically at your chosen time.")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.chip}`}>{tr(status.label)}</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{tr("Not submitted yet")}</span>}
          {(!settings?.templateStatus || settings.templateStatus === 'REJECTED') && <Button size="sm" onClick={() => submitTemplate.mutate(undefined, { onSuccess: () => toast(tr("Template submitted to Meta for review"), 'success'), onError: (e: any) => toast(e.message || tr("Could not submit"), 'error') })} disabled={submitTemplate.isPending}>{submitTemplate.isPending ? tr("Submitting…") : tr("Submit for approval")}</Button>}
          {settings?.templateStatus === 'PENDING' && <Button size="sm" variant="outline" onClick={() => syncTemplate.mutate(undefined, { onSuccess: () => toast(tr("Checked with Meta"), 'success'), onError: (e: any) => toast(e.message || tr("Could not check"), 'error') })} disabled={syncTemplate.isPending}>{syncTemplate.isPending ? tr("Checking…") : tr("Check status with Meta")}</Button>}
          {settings?.templateStatus === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => sendNow.mutate(undefined, { onSuccess: (r) => toast(tr("Sent to {sent} number(s){value}", { sent: r.sent, value: r.failed.length ? `, ${r.failed.length} failed` : '' }), r.failed.length ? 'error' : 'success'), onError: (e: any) => toast(e.message || tr("Could not send"), 'error') })} disabled={sendNow.isPending}>{sendNow.isPending ? tr("Sending…") : tr("Send test now")}</Button>}
        </div>
        {settings?.templateStatus === 'REJECTED' && settings.templateRejectionReason && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{tr("Meta's reason:")}{' '}{settings.templateRejectionReason}</p>}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-navy">{tr("3. Live preview")}</h3>
        <p className="mt-1 text-sm text-slate-500">{tr("Exactly what today's message looks like right now, pulled fresh from every section's own live data.")}</p>
        {preview && (
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl bg-[#efeae2] p-4">
              <div className="ml-auto w-full max-w-sm rounded-lg rounded-tr-none bg-[#d9fdd3] p-3 text-sm shadow-sm">
                <p className="whitespace-pre-wrap">{preview.text}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SECTIONS.map((s) => <div key={s.key} className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{tr(s.label)}</p><p className="mt-1 text-xs text-slate-500">{s.hint}</p></div>)}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
