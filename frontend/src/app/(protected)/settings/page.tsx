'use client';
import { displayEmail } from '@/lib/display-email';
import { DailyReportPanel } from '@/components/settings/daily-report-panel';
import { DailyReportNewLayout } from '@/components/settings/daily-report-new-layout';
import { TrashPanel } from '@/components/settings/trash-panel';
import { PasswordButton, PasswordDialog } from '@/components/settings/password-dialog';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {Bell,BellOff,Building2,CheckCircle2,Cloud,Eye,EyeOff,Image as ImageIcon,KeyRound,MessageSquareText,Plus,ShieldCheck,Trash2,Users} from 'lucide-react';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api-client';
import {useAuthStore} from '@/store/auth-store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useToast} from '@/components/ui/toast';
import {useWhatsAppHealth} from '@/hooks/use-whatsapp';

const API_URL=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api';
const API_ORIGIN=API_URL.replace(/\/api\/?$/,'');
type Tab='company'|'users'|'api'|'notifications'|'dailyreport'|'trash'; type Company=Record<string,any>;
const identity=[['companyName','Company name'],['legalName','Legal name'],['tagline','Tagline'],['phone','Company phone'],['email','Company email'],['website','Website'],['gstin','GSTIN'],['address','Office address']];
const bank=[['bankName','Bank name'],['bankAccountName','Account holder'],['bankAccountNumber','Account number'],['bankIfsc','IFSC code'],['bankBranch','Bank branch'],['upiId','UPI ID']];
type IconShape='square'|'round';
async function loadPicture(file:File):Promise<HTMLImageElement>{
 const url=URL.createObjectURL(file);
 try{return await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('This file cannot be opened as a picture. Please use a PNG, JPG, WEBP or SVG image.'));img.src=url;});}
 finally{setTimeout(()=>URL.revokeObjectURL(url),5000);}
}
// The part of the picture that is actually artwork (not transparent and not plain white).
function artworkBox(ctx:CanvasRenderingContext2D,w:number,h:number){
 const d=ctx.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=-1,y1=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(d[i+3]>12&&!(d[i]>244&&d[i+1]>244&&d[i+2]>244)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
 if(x1<0)return {x:0,y:0,w,h};
 const pad=Math.round(Math.max(x1-x0,y1-y0)*0.04);x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(w-1,x1+pad);y1=Math.min(h-1,y1+pad);
 return {x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
}
async function toBrandPng(file:File,kind:'logo'|'favicon',shape:IconShape):Promise<File>{
 const img=await loadPicture(file);
 const sw=img.naturalWidth||512,sh=img.naturalHeight||512;
 const scale=Math.min(1,1600/Math.max(sw,sh));
 const src=document.createElement('canvas');src.width=Math.max(1,Math.round(sw*scale));src.height=Math.max(1,Math.round(sh*scale));
 const sctx=src.getContext('2d');if(!sctx)throw new Error('This browser cannot prepare the image.');
 sctx.drawImage(img,0,0,src.width,src.height);
 const box=artworkBox(sctx,src.width,src.height);
 const out=document.createElement('canvas');const ctx=out.getContext('2d')!;
 if(kind==='logo'){
  const k=Math.min(1,512/Math.max(box.w,box.h));out.width=Math.max(1,Math.round(box.w*k));out.height=Math.max(1,Math.round(box.h*k));
  ctx.drawImage(src,box.x,box.y,box.w,box.h,0,0,out.width,out.height);
 }else{
  const size=256;out.width=size;out.height=size;
  if(shape==='round'){ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.closePath();ctx.clip();}
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size,size);
  const room=size*(shape==='round'?0.8:0.92);const k=Math.min(room/box.w,room/box.h);const dw=box.w*k,dh=box.h*k;
  ctx.drawImage(src,box.x,box.y,box.w,box.h,(size-dw)/2,(size-dh)/2,dw,dh);
 }
 const blob=await new Promise<Blob|null>(resolve=>out.toBlob(resolve,'image/png'));
 if(!blob)throw new Error('This browser cannot prepare the image.');
 return new File([blob],kind==='logo'?'logo.png':`tab-icon-${shape}.png`,{type:'image/png'});
}
export default function SettingsPage(){
 const router=useRouter();const {toast}=useToast();const token=useAuthStore(s=>s.accessToken);const user=useAuthStore(s=>s.user);const [tab,setTab]=useState<Tab>('company');useEffect(()=>{const t=new URLSearchParams(window.location.search).get('tab');if(t==='trash'||t==='users'||t==='api'||t==='notifications'||t==='dailyreport')setTab(t as Tab);},[]);const [reveal,setReveal]=useState(false);const [passwordUser,setPasswordUser]=useState<any>(null);
 const whatsappHealth=useWhatsAppHealth().data;

 const whatsappDisconnected=!!whatsappHealth?.configured&&(!whatsappHealth.tokenValid||!whatsappHealth.secretValid||!whatsappHealth.subscribed||whatsappHealth.inboundStale);
 const {data}=useQuery({queryKey:['company-settings'],queryFn:()=>api.get<Company>('/settings/company')});
 const {data:users}=useQuery({queryKey:['settings-users-summary'],queryFn:()=>api.get<{data:any[];total:number}>('/users')});
 const {data:integrations,isFetching:loadingKeys}=useQuery({queryKey:['integration-status',reveal],queryFn:()=>api.get<{data:any[]}>(`/settings/company/integrations?reveal=${reveal}`)});
 const [form,setForm]=useState<Record<string,string>>({});const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState('');
 const {data:notifPref,refetch:refetchNotifPref}=useQuery({queryKey:['my-notification-preference'],queryFn:()=>api.get<{enabled:boolean}>('/users/me/notifications')});
 const [notifSaving,setNotifSaving]=useState(false);
 async function toggleNotifications(next:boolean){setNotifSaving(true);try{await api.patch('/users/me/notifications',{enabled:next});await refetchNotifPref();toast(next?'Notifications enabled':'Notifications disabled — you will not receive push alerts for new leads, callbacks or itinerary sends','success')}catch(e:any){toast(e.message,'error')}finally{setNotifSaving(false)}}
 useEffect(()=>{if(data)setForm({companyName:data.company_name||'',legalName:data.legal_name||'',tagline:data.tagline||'',logoUrl:data.logo_url||'',logoObjectKey:data.logo_object_key||'',faviconUrl:data.favicon_url||'',faviconObjectKey:data.favicon_object_key||'',phone:data.phone||'',email:data.email||'',website:data.website||'',address:data.address||'',gstin:data.gstin||'',bankName:data.bank_name||'',bankAccountName:data.bank_account_name||'',bankAccountNumber:data.bank_account_number||'',bankIfsc:data.bank_ifsc||'',bankBranch:data.bank_branch||'',upiId:data.upi_id||''});},[data]);
 // Used to just set local form state and tell the user to separately click "Save company
 // profile" below -- easy to miss (it's a small toast), so the logo/favicon looked "uploaded"
 // (the preview box showed it) while nothing was actually persisted, and every other place that
 // reads the logo (sidebar, login page, browser tab, documents) kept showing the old/default one
 // indefinitely. Now it saves itself immediately, right after a successful upload.
 const [iconShape,setIconShape]=useState<IconShape>('square');const lastIconFile=useRef<File|null>(null);
 useEffect(()=>{try{const v=localStorage.getItem('tab-icon-shape');if(v==='round'||v==='square')setIconShape(v);}catch{/* ignore */}},[]);
 // A picture dropped just outside a box must not make the browser open it and leave this page.
 useEffect(()=>{const stop=(e:DragEvent)=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();};window.addEventListener('dragover',stop);window.addEventListener('drop',stop);return()=>{window.removeEventListener('dragover',stop);window.removeEventListener('drop',stop);};},[]);
 async function changeIconShape(shape:IconShape){
  setIconShape(shape);try{localStorage.setItem('tab-icon-shape',shape);}catch{/* ignore */}
  if(lastIconFile.current){await upload(lastIconFile.current,'favicon',shape);return;}
  if(form.faviconUrl){try{const blob=await (await fetch(form.faviconUrl)).blob();await upload(new File([blob],'tab-icon.png',{type:blob.type||'image/png'}),'favicon',shape);}catch{toast('Choose the tab icon image again to apply this shape','error');}}
 }
 async function upload(original:File,type:'logo'|'favicon',shape:IconShape=iconShape){setUploading(type);try{if(type==='favicon')lastIconFile.current=original;const file=await toBrandPng(original,type,shape);const body=new FormData();body.append('file',file);body.append('folder','company-branding');const res=await fetch(`${API_URL}/files/upload`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body});if(!res.ok){const why=await res.json().catch(()=>null);throw new Error(why?.message||'Upload failed');}const v=await res.json();const resolvedUrl=v.publicUrl?(v.publicUrl.startsWith('http')?v.publicUrl:`${API_ORIGIN}${v.publicUrl}`):v.url;const next={...form,[type==='logo'?'logoUrl':'faviconUrl']:resolvedUrl,[type==='logo'?'logoObjectKey':'faviconObjectKey']:v.objectKey};setForm(next);await api.patch('/settings/company',next);toast(`${type==='logo'?'Logo':'Browser tab icon'} updated everywhere it appears.`,'success');setBrandNow(type,resolvedUrl);}catch(e:any){toast(e.message,'error')}finally{setUploading('')}}
 function setBrandNow(type:'logo'|'favicon',url:string){if(type==='favicon'||!form.faviconUrl){let link=document.querySelector("link[rel~='icon']") as HTMLLinkElement|null;if(!link){link=document.createElement('link');link.rel='icon';document.head.appendChild(link);}link.href=url;}if(type==='logo')setTimeout(()=>location.reload(),900);}
 async function removeImage(type:'logo'|'favicon'){setUploading(type);try{const cleared:Record<string,string>=type==='logo'?{logoUrl:'',logoObjectKey:''}:{faviconUrl:'',faviconObjectKey:''};setForm(f=>({...f,...cleared}));await api.patch('/settings/company',cleared);if(type==='favicon')lastIconFile.current=null;toast(`${type==='logo'?'Logo':'Browser tab icon'} removed.`,'success');setTimeout(()=>location.reload(),900);}catch(e:any){toast(e.message,'error')}finally{setUploading('')}}
 async function save(){setSaving(true);try{await api.patch('/settings/company',form);toast('Company profile saved','success');setTimeout(()=>location.reload(),500)}catch(e:any){toast(e.message,'error')}finally{setSaving(false)}}
 const tabs=[{id:'company' as Tab,label:'Company profile',icon:Building2},{id:'notifications' as Tab,label:'Notifications',icon:Bell},{id:'dailyreport' as Tab,label:'Daily WhatsApp Report',icon:MessageSquareText},{id:'users' as Tab,label:'Company users',icon:Users},{id:'api' as Tab,label:'API integrations',icon:KeyRound},{id:'trash' as Tab,label:'Trash',icon:Trash2}];
 return <div className="mx-auto max-w-7xl space-y-5 pb-10"><div><h1 className="text-3xl font-bold text-navy dark:text-white">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Manage your company, team and connected services.</p></div><div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]"><aside className="h-fit rounded-2xl border bg-white p-2 shadow-sm">{tabs.map(({id,label,icon:Icon})=><button key={id} onClick={()=>setTab(id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold ${tab===id?'bg-navy text-white shadow':'text-slate-600 hover:bg-slate-50'}`}><Icon className={`h-4 w-4 ${tab===id?'text-gold':''}`}/>{label}</button>)}</aside><main>
 {tab==='company'&&<div className="space-y-5"><section className="rounded-2xl border bg-white p-6 shadow-sm"><div><h2 className="text-xl font-bold text-navy">Brand identity</h2><p className="text-sm text-slate-500">Used across login, navigation, browser tab and documents.</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Brand label="Company logo" value={form.logoUrl} busy={uploading==='logo'} onFile={f=>upload(f,'logo')} onRemove={()=>removeImage('logo')}/><div className="space-y-2"><Brand label="Browser tab icon" value={form.faviconUrl} round={iconShape==='round'} busy={uploading==='favicon'} onFile={f=>upload(f,'favicon')} onRemove={()=>removeImage('favicon')}/><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-slate-500">Icon shape</span>{(['square','round'] as IconShape[]).map(sh=><button key={sh} type="button" disabled={uploading==='favicon'} onClick={()=>changeIconShape(sh)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold capitalize disabled:opacity-50 ${iconShape===sh?'border-gold bg-gold/15 text-navy':'border-slate-200 text-slate-600 hover:border-gold/50'}`}><span className={`h-3.5 w-3.5 border-2 border-current ${sh==='round'?'rounded-full':'rounded-[3px]'}`}/>{sh}</button>)}{!form.faviconUrl&&<span className="text-slate-400">Without a tab icon, the company logo is used.</span>}</div></div></div></section><Fields title="Company details" fields={identity} form={form} setForm={setForm}/><Fields title="Bank details" fields={bank} form={form} setForm={setForm}/><div className="flex justify-end"><Button variant="gold" onClick={save} disabled={saving}>{saving?'Saving…':'Save company profile'}</Button></div></div>}
 {tab==='notifications'&&<div className="space-y-5"><section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-bold text-navy">Push notifications</h2><p className="mt-1 text-sm text-slate-500">Turn off if you don't want new leads, callback requests or itinerary-sent alerts popping up on this account. This is separate from your browser's own notification permission.</p><div className={`mt-5 flex items-center justify-between rounded-xl border p-5 ${notifPref?.enabled!==false?'border-emerald-200 bg-emerald-50':'border-slate-200 bg-slate-50'}`}><div className="flex items-center gap-3">{notifPref?.enabled!==false?<Bell className="h-5 w-5 text-emerald-600"/>:<BellOff className="h-5 w-5 text-slate-400"/>}<div><p className="font-bold text-navy">{notifPref?.enabled!==false?'Notifications are ON':'Notifications are OFF'}</p><p className="text-xs text-slate-500">New leads, "request a call back" taps, and itinerary-sent confirmations.</p></div></div><button type="button" disabled={notifSaving} onClick={()=>toggleNotifications(!(notifPref?.enabled!==false))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${notifPref?.enabled!==false?'bg-gold':'bg-slate-300'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifPref?.enabled!==false?'translate-x-6':'translate-x-1'}`}/></button></div></section></div>}
 {tab==='dailyreport'&&<><DailyReportNewLayout/><DailyReportPanel/></>}
 {tab==='trash'&&<TrashPanel/>}
 {passwordUser&&<PasswordDialog user={passwordUser} onClose={()=>setPasswordUser(null)}/>}{tab==='users'&&<div className="space-y-5"><section className="rounded-2xl border bg-gradient-to-br from-navy to-slate-900 p-6 text-white shadow-xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-gold">Team access</p><h2 className="mt-2 text-2xl font-bold">Company users</h2><p className="mt-2 max-w-xl text-sm text-slate-300">Create employees, control round-robin participation and manage roles. Click an employee below to set which pages they can see.</p></div><Link href="/settings/users"><Button variant="gold">Manage users</Button></Link></div></section><section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_auto] border-b bg-slate-50 px-5 py-3 text-xs font-bold uppercase text-slate-500"><span>User</span><span>Role</span><span>Mobile</span><span>Password</span><span>Status</span></div>{(users?.data||[]).map(item=><div key={item.id} role="button" tabIndex={0} onClick={()=>router.push(`/settings/users/${item.id}`)} onKeyDown={(e)=>{if(e.key==='Enter')router.push(`/settings/users/${item.id}`)}} title="Click to set this employee's access" className="grid cursor-pointer grid-cols-[1.3fr_1fr_1fr_1fr_auto] items-center border-b px-5 py-4 text-sm transition hover:bg-gold/5"><div><p className="font-semibold text-navy">{item.full_name}</p><p className="text-xs text-slate-400">{displayEmail(item.email)}</p></div><span className="capitalize">{String(item.role_name||'—').replace(/_/g,' ')}</span><span>{item.phone||'—'}</span><span>{item.id ? <PasswordButton onClick={()=>setPasswordUser(item)}/> : null}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.is_active?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{item.is_active?'Active':'Inactive'}</span></div>)}</section></div>}
 {tab==='api'&&<div className="space-y-5"><section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-navy">API integrations</h2><p className="mt-1 text-sm text-slate-500">Click a connection below to see its real, live status — not just whether a key is saved.</p></div><Button variant="outline" onClick={()=>setReveal(v=>!v)} disabled={loadingKeys}>{reveal?<EyeOff className="mr-2 h-4 w-4"/>:<Eye className="mr-2 h-4 w-4"/>}{reveal?'Hide keys':'Show keys'}</Button></div><div className="mt-6 grid gap-4 xl:grid-cols-2">{(integrations?.data||[]).map(item=>{const broken=item.key==='whatsapp'&&whatsappDisconnected;return <div key={item.key} role="button" tabIndex={0} onClick={()=>router.push(`/settings/integrations?key=${item.key}`)} onKeyDown={(e)=>{if(e.key==='Enter')router.push(`/settings/integrations?key=${item.key}`)}} className={`cursor-pointer rounded-2xl border p-5 transition hover:shadow-md ${broken?'border-red-300 bg-red-50/40 hover:border-red-400':'border-slate-200 hover:border-gold'}`}><div className="flex items-start justify-between"><div className="flex gap-3"><span className="rounded-xl bg-gold/15 p-2.5 text-gold"><Cloud className="h-5 w-5"/></span><div><h3 className="font-bold text-navy">{item.name}</h3><p className="text-xs text-slate-500">{item.purpose}</p></div></div>{item.key==='whatsapp'&&whatsappDisconnected?<span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700"><CheckCircle2 className="h-3.5 w-3.5"/>Disconnected</span>:<span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${item.configured?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}><CheckCircle2 className="h-3.5 w-3.5"/>{item.configured?'Connected':'Setup needed'}</span>}</div><div className="mt-4 space-y-2">{(item.fields||[]).map((field:any)=><div key={field.label} className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{field.label}</p><p className="mt-1 break-all font-mono text-xs text-slate-700">{field.value||'Not configured'}</p></div>)}</div><div className="mt-4 flex items-center justify-between"><span className="text-xs font-semibold text-gold">View live status →</span>{item.editHref&&<Link href={item.editHref} onClick={(e)=>e.stopPropagation()}><Button size="sm" variant="outline">Replace configuration</Button></Link>}</div></div>;})}</div></section><p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"><ShieldCheck className="mr-2 inline h-4 w-4"/>Keys are visible only to authorised super admins. WhatsApp credentials can be replaced here; server-managed Meta, storage and push keys are displayed for verification.</p></div>}
 </main></div></div>;
}
function Fields({title,fields,form,setForm}:{title:string;fields:string[][];form:Record<string,string>;setForm:any}){return <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-navy">{title}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{fields.map(([key,label])=><div key={key} className={key==='address'?'sm:col-span-2':''}><Label>{label}</Label><Input className="mt-1.5" value={form[key]||''} onChange={e=>setForm((v:any)=>({...v,[key]:e.target.value}))}/></div>)}</div></section>}
function Brand({label,value,busy,onFile,onRemove,round}:{label:string;value?:string;busy:boolean;onFile:(f:File)=>void;onRemove:()=>void;round?:boolean}){
 const [dragOver,setDragOver]=useState(false);
 const accept='image/*,.svg,.ico,.avif,.webp';
 return <label
   onDragOver={e=>{e.preventDefault();if(!busy)setDragOver(true)}}
   onDragLeave={()=>setDragOver(false)}
   onDrop={e=>{e.preventDefault();setDragOver(false);e.stopPropagation();const f=e.dataTransfer.files?.[0];if(f&&!busy)onFile(f)}}
   className={`flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed p-4 transition-colors ${dragOver?'border-gold bg-gold/5':'border-slate-200 hover:border-gold/50'}`}
 >
   {value?<img src={value} alt="" className={`h-16 w-16 shrink-0 border bg-white object-contain ${round?'rounded-full':'rounded-xl'}`}/>:<div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100"><ImageIcon className="h-6 w-6 text-slate-400"/></div>}
   <div className="min-w-0 flex-1">
     <p className="text-sm font-semibold">{label}</p>
     <p className="mt-0.5 text-xs text-slate-400">{busy?'Working…':dragOver?'Drop to upload':value?'Click or drop a new image to replace it':'Drag & drop an image here, or click to choose'}</p>
     {value&&!busy&&<button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();onRemove()}} className="mt-1.5 rounded-md border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50">Remove image</button>}
     <input type="file" accept={accept} hidden disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)onFile(f)}}/>
   </div>
 </label>;
}

