'use client';

import { renderPdfFirstPage } from '@/lib/pdf-thumb';
import { ItinerarySetup, MessageTemplatePicker, PresetField, SetupPicker } from './preset-field';
import { ActiveSwitch } from './active-switch';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, FileText, MoreVertical, Paperclip, Moon, Sun, Phone, ExternalLink, MessageCircle, PhoneCall, RefreshCw, Send, Upload, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { usePackages, fetchPackageDocumentBytes, getPackageDocumentPreview, useCreatePackage, useItineraryPresetActions, useItineraryPresets, useMetaCampaigns, useUpdatePackage, uploadPackageDocument } from '@/hooks/use-packages';
import { useSendTestItinerary, useSubmitItineraryTemplate, useSyncItineraryTemplate, fetchPackageDelivery, savePackageThumbnail, usePackageDelivery, useSendPendingItinerary, useUpdateTestNumbers, useWhatsAppAutomation, useWhatsAppProfile } from '@/hooks/use-whatsapp';
import { PackageButton, TourPackage } from '@/types/package';
import { tr, locale } from '@/i18n';

const DESTINATIONS = [
  'Andaman','Amritsar','Ayodhya','Bhutan','Coorg','Darjeeling','Dubai','Europe','Goa','Gangtok','Himachal','Hyderabad',
  'Japan','Kashmir','Kasi','Kerala','Kodaikanal','Ladakh','Malaysia','Maldives','Manali','Meghalaya','Munnar','Mysore',
  'Nepal','Ooty','Rajasthan','Rameswaram','Rishikesh','Shimla','Sikkim','Singapore','Sri Lanka','Switzerland','Thailand',
  'Tirupati','Turkey','Udaipur','Varanasi','Vietnam',
];
// Words every campaign name shares (agency prefix, filler, dates), stripped so
// whatever remains is a reasonable guess at the destination for a campaign whose
// place isn't in DESTINATIONS above -- better than leaving the field blank.
const CAMPAIGN_BOILERPLATE = /\b(smm|socialmm|trt|high|intent|traveller|travellers|package|packages|leads?|lead\s*form|errance|voyages?|travels?|tour|tours|itinerary|2025|2026|2027|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/gi;
function guessDestinationFromCampaign(campaignName: string): string {
  const known = DESTINATIONS.find((place) => new RegExp(`\\b${place}\\b`, 'i').test(campaignName));
  if (known) return known;
  const cleaned = campaignName
    .split(/[|–—-]/)
    .map((part) => part.replace(CAMPAIGN_BOILERPLATE, ' ').replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 2);
  return cleaned.sort((a, b) => b.length - a.length)[0] || '';
}
const STEPS = ['Campaign','Content & Upload','Meta approval','Test message','Activate'];

export function PackageForm({ pkg }: { pkg?: TourPackage }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const createPackage = useCreatePackage();
  const updatePackage = useUpdatePackage(pkg?.id ?? '');
  const { data: campaigns, isLoading: campaignsLoading, refetch, isFetching } = useMetaCampaigns();
  const { data: automation } = useWhatsAppAutomation();
  const { data: profile } = useWhatsAppProfile();
  const updateTestNumbers = useUpdateTestNumbers();
  const sendPending = useSendPendingItinerary();
  const sendTest = useSendTestItinerary();
  const submitTemplate = useSubmitItineraryTemplate();
  const syncTemplate = useSyncItineraryTemplate();
  const initialStage = params.get('stage') === 'test' ? 3 : 1;
  // Unsaved work survives a refresh: the form is mirrored to localStorage and
  // cleared once the itinerary is saved.
  const DRAFT_KEY = `itinerary-draft-${pkg?.id ?? 'new'}`;
  const draft: Record<string, any> = (() => {
    if (typeof window === 'undefined' || params.get('another')) return {};
    try { return JSON.parse(window.localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { return {}; }
  })();
  const clearDraft = () => { try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  const [step, setStep] = useState<number>(pkg ? initialStage : (params.get('stage') === 'test' ? 3 : draft.step ?? initialStage));
  const [campaignName, setCampaignName] = useState<string>(params.get('campaign') ?? draft.campaignName ?? pkg?.campaign_name ?? '');
  const [destination, setDestination] = useState<string>(draft.destination ?? pkg?.destinations?.[0] ?? params.get('destination') ?? '');
  const [days, setDays] = useState<string>(String(draft.days ?? pkg?.duration_days ?? ''));
  const [nights, setNights] = useState<string>(String(draft.nights ?? pkg?.duration_nights ?? ''));
  const durationLabel = (d: string, n: string) => (d ? `${d} Day${d === '1' ? '' : 's'}${n !== '' ? ` / ${n} Night${n === '1' ? '' : 's'}` : ''}` : '');
  const [name, setName] = useState<string>(draft.name ?? pkg?.name ?? '');
  const [objectKey, setObjectKey] = useState<string>(draft.objectKey ?? pkg?.itinerary_pdf_object_key ?? '');
  const [fileName, setFileName] = useState<string>(draft.fileName ?? pkg?.itinerary_pdf_file_name ?? '');
  const DEFAULT_TEMPLATE = 'Dreaming of {destination} but worried about planning, hotels and cost?\n\n✨ We have done it for you — a ready {destination} itinerary with handpicked stays, sightseeing and transfers, all within your budget.';
  const splitMessage = (text: string): [string, string] => {
    const clean = text.replace(/\r/g, '').trim();
    const parts = clean.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')];
    const one = (parts[0] || clean).replace(/\s+/g, ' ');
    const match = one.match(/^(.+?[?!.])\s+(.+)$/);
    return match ? [match[1], match[2]] : [one, 'Tap a button below to reach our expert.'];
  };
  const fillTemplate = (template: string, place: string) => template.replace(/\{destination\}/g, place || 'your destination');
  const introFor = (place: string) => fillTemplate(DEFAULT_TEMPLATE, place);
  const [message, setMessage] = useState<string>(draft.message ?? (pkg?.description || introFor(pkg?.destinations?.[0] ?? '')));
  const [messageEdited, setMessageEdited] = useState<boolean>(draft.messageEdited ?? !!pkg?.description);
  const [contactNumber, setContactNumber] = useState<string>(draft.contactNumber ?? pkg?.contact_number ?? '');
  const [testNumber, setTestNumber] = useState('');
  const [tested, setTested] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [metaDetails, setMetaDetails] = useState<TourPackage['meta_details']>(null);
  const [templateStatus, setTemplateStatus] = useState(pkg?.whatsapp_template_status || 'NOT_SUBMITTED');
  const [templateReason, setTemplateReason] = useState(pkg?.whatsapp_template_rejection_reason || '');
  const [active, setActive] = useState(pkg?.is_active ?? false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [pageImg, setPageImg] = useState('');
  const [pages, setPages] = useState(0);
  const [fileSize, setFileSize] = useState<number>(draft.fileSize ?? 0);
  const [buttonLabel, setButtonLabel] = useState<string>(draft.buttonLabel ?? pkg?.contact_button_text ?? 'Call our experts');
  const [buttons, setButtons] = useState<PackageButton[]>(draft.buttons ?? pkg?.buttons ?? [{ type: 'call', text: pkg?.contact_button_text || 'Call our experts', phone: pkg?.contact_number || '' }, { type: 'chat', text: 'Chat with us' }]);
  const orderedButtons: PackageButton[] = [...buttons.filter((b) => b.type === 'call').slice(0, 1), ...buttons.filter((b) => b.type === 'url' || b.type === 'chat').slice(0, 2)];
  const buttonCounts = { call: buttons.filter((b) => b.type === 'call').length, url: buttons.filter((b) => b.type === 'url').length, chat: buttons.filter((b) => b.type === 'chat').length };
  const updateButton = (index: number, patch: Partial<PackageButton>) => setButtons((list) => list.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const [contactName, setContactName] = useState<string>(draft.contactName ?? pkg?.contact_name ?? '');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewDark, setPreviewDark] = useState(false);
  const [phoneZoom, setPhoneZoom] = useState(100);
  const [autoFit, setAutoFit] = useState(true);
  const [fitZoom, setFitZoom] = useState(100);
  const phoneRef = useRef<HTMLDivElement>(null);
  const effZoom = autoFit ? fitZoom : phoneZoom;
  const [template, setTemplate] = useState<string>(draft.template ?? '');
  const presets = useItineraryPresets().data ?? [];
  const presetActions = useItineraryPresetActions();
  const byKind = (kind: string) => presets.filter((item) => item.kind === kind);
  const listActions = (kind: 'name' | 'number' | 'button' | 'message' | 'setup' | 'reply' | 'link') => ({ add: (value: string) => presetActions.add.mutate({ kind, value }), update: (id: string, value: string) => presetActions.update.mutate({ id, value }), remove: (id: string) => presetActions.remove.mutate(id) });
  const [campaignOpen, setCampaignOpen] = useState(false);

  useEffect(() => {
    if (!campaignName || destination.trim()) return;
    const matched = guessDestinationFromCampaign(campaignName);
    if (matched) {
      setDestination(matched);
      if (!name || !pkg) setName(`${matched} Itinerary`);
    }
  }, [campaignName, name, pkg, destination]);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, campaignName, destination, days, nights, name, objectKey, fileName, message, messageEdited, contactNumber, contactName, buttonLabel, buttons, template, fileSize }));
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, campaignName, destination, days, nights, name, objectKey, fileName, message, messageEdited, contactNumber, contactName, buttonLabel, buttons, template, fileSize]);
  useEffect(() => {
    if (messageEdited) return;
    const base = template || byKind('message')[0]?.value || DEFAULT_TEMPLATE;
    setMessage(fillTemplate(base, destination));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, template, presets.length, messageEdited]);
  useEffect(() => {
    if (!objectKey) return setPreviewUrl('');
    getPackageDocumentPreview(objectKey).then((value) => { setPreviewUrl(value.url || ''); if (value.url && /\.pdf$/i.test(fileName)) fetchPackageDocumentBytes(objectKey).then((bytes) => renderPdfFirstPage(bytes)).then((r) => { setPageImg(r.img); setPages(r.pages); }).catch(() => undefined); }).catch(() => setPreviewUrl(''));
  }, [objectKey]);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setUploading(true); setProgress({ loaded: 0, total: file.size }); setPageImg(''); setPages(0); setFileSize(file.size);
    if (/\.pdf$/i.test(file.name)) renderPdfFirstPage(file).then((r) => { setPageImg(r.img); setPages(r.pages); }).catch(() => undefined);
    try { const result = await uploadPackageDocument(file, 'packages/itineraries', (loaded, total) => setProgress({ loaded, total })); setObjectKey(result.objectKey); setFileName(file.name); setPreviewUrl(result.url); toast(tr("Itinerary uploaded"),'success'); }
    catch (error:any) { toast(error.message || tr("Upload failed"),'error'); }
    finally { setUploading(false); setProgress(null); }
  }

  function payload(isActive = active) {
    return { name: name.trim() || `${destination} Itinerary`, destinations:[destination], durationDays: days ? Number(days) : undefined, durationNights: nights !== '' ? Number(nights) : undefined, campaignName, contactNumber:contactNumber.trim(), contactName:contactName.trim(), buttons: buttons.map((b) => ({ ...b, text: b.text.trim(), phone: b.phone?.trim() || undefined, url: b.url?.trim() || undefined, reply: b.reply?.trim() || undefined })), contactButtonText: (buttons.find((b) => b.type === 'call')?.text || 'Call our experts').trim(), itineraryPdfObjectKey:objectKey, itineraryPdfFileName:fileName, description:message.trim(), isActive, isTemplate:false, branchId:pkg?.branch_id ?? branchId };
  }

  function checkApproval(showToast = false) {
    if (!pkg) return Promise.resolve();
    return syncTemplate.mutateAsync(pkg.id).then((result) => {
      setTemplateStatus(result.whatsapp_template_status);
      setTemplateReason(result.whatsapp_template_rejection_reason || '');
      setCheckedAt(new Date());
      setMetaDetails(result.meta_details ?? null);
      if (showToast) toast(result.whatsapp_template_status === 'APPROVED' ? tr("Template approved by Meta") : tr("Status refreshed"), 'success');
    }).catch((e: any) => { if (showToast) toast(e.message || tr("Status refresh failed"), 'error'); });
  }
  // Load Meta's details once when the approval stage opens for an already-submitted template.
  useEffect(() => {
    if (step === 3 && pkg && templateStatus !== 'NOT_SUBMITTED' && !metaDetails) checkApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pkg?.id]);
  // While Meta is reviewing, re-check on entering the stage and every 20 seconds.
  useEffect(() => {
    if (step !== 3 || !pkg || templateStatus === 'NOT_SUBMITTED' || templateStatus === 'APPROVED' || templateStatus === 'REJECTED') return;
    checkApproval();
    const timer = setInterval(() => { checkApproval(); }, 20000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pkg?.id, templateStatus]);

  const mobileDigits = (value: string) => { let d = value.replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); if (d.length === 11 && d.startsWith('0')) d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? d : null; };
  const normalizePhone = (value: string) => { const digits = value.replace(/\D/g, ''); return digits.length === 10 ? `91${digits}` : digits; };
  const testList = automation?.test_numbers || [];
  const testActions = {
    add: (value: string) => { const n = normalizePhone(value); if (n.length >= 10 && !testList.includes(n)) updateTestNumbers.mutate([...testList, n]); },
    update: (id: string, value: string) => { const n = normalizePhone(value); if (n.length >= 10) updateTestNumbers.mutate(testList.map((x) => (x === id ? n : x))); },
    remove: (id: string) => updateTestNumbers.mutate(testList.filter((x) => x !== id)),
  };
  async function sendTestMessage() {
    if (!pkg) return;
    const n = normalizePhone(testNumber);
    if (n.length < 11) return toast(tr("Enter a valid mobile number"), 'error');
    try {
      if (!testList.includes(n)) await updateTestNumbers.mutateAsync([...testList, n]);
      await sendTest.mutateAsync({ packageId: pkg.id, to: n });
      setTested(true);
      toast(tr("Test message accepted by WhatsApp"), 'success');
    } catch (e: any) { toast(e.message || tr("Test failed"), 'error'); }
  }
  const thumbSent = useRef('');
  useEffect(() => {
    if (!pkg?.id || !pageImg) return;
    const key = `${pkg.id}:${objectKey}`;
    if (thumbSent.current === key) return;
    thumbSent.current = key;
    savePackageThumbnail(pkg.id, pageImg).catch(() => undefined);
  }, [pkg?.id, pageImg, objectKey]);
  const delivery = usePackageDelivery(pkg?.id, step === 5).data;
  async function sendBacklog() {
    if (!pkg || !delivery) return;
    // No confirm() -- clicking this button is the confirmation, same as the Active switch.
    try {
      const r = await sendPending.mutateAsync(pkg.id);
      toast(tr("Sent {sent}{value}{value2}{value3}", { sent: r.sent, value: r.skippedTestMode ? `, ${r.skippedTestMode} skipped (test mode)` : '', value2: r.failed ? `, ${r.failed} failed` : '', value3: r.noPhone ? `, ${r.noPhone} without a valid number` : '' }), r.failed ? 'error' : 'success');
    } catch (e: any) { toast(e.message || tr("Could not send"), 'error'); }
  }
  function applySetup(setup: ItinerarySetup) {
    setDestination(setup.destination);
    setName(setup.name);
    setContactName(setup.contactName || '');
    setContactNumber(setup.contactNumber || '');
    setButtonLabel(setup.buttonLabel || 'Call our experts');
    if (setup.buttons?.length) setButtons(setup.buttons);
    setTemplate('');
    setMessageEdited(true);
    setMessage(fillTemplate(setup.message, setup.destination));
    setPageImg(''); setPages(0); setFileSize(setup.fileSize || 0);
    setFileName(setup.fileName);
    setObjectKey(setup.objectKey);
    toast(tr("Saved itinerary applied — adjust anything you need"), 'success');
  }
  function saveSetup() {
    if (!objectKey || !destination.trim()) return toast(tr("Add the destination and upload the PDF first"), 'error');
    const title = window.prompt('Name for this saved itinerary', `${destination} – ${name || 'Itinerary'}`);
    if (!title || !title.trim()) return;
    const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const setup: ItinerarySetup = {
      title: title.trim(), destination: destination.trim(), name, contactName, contactNumber, buttonLabel, buttons, objectKey, fileName, fileSize,
      message: message.replace(new RegExp(escaped, 'gi'), '{destination}'),
    };
    presetActions.add.mutate({ kind: 'setup', value: JSON.stringify(setup) });
    toast(tr("Saved. Find it under “Use saved” next time."), 'success');
  }

  // The number typed on the Call button is the expert number (shown in the message);
  // Chat buttons whose number was not edited follow it.
  const callPhone = buttons.find((b) => b.type === 'call')?.phone?.trim() || '';
  useEffect(() => {
    setContactNumber(callPhone);
    setButtons((list) => (list.some((b) => b.type === 'chat' && !b.replyTouched && (b.phone || '') !== callPhone) ? list.map((b) => (b.type === 'chat' && !b.replyTouched ? { ...b, phone: callPhone } : b)) : list));
  }, [callPhone]);

  // Shrink the phone (never scroll it) so the whole preview fits the visible screen.
  useEffect(() => {
    const measure = () => {
      const el = phoneRef.current;
      if (!el) return;
      const previous = el.style.zoom;
      el.style.zoom = '1';
      const natural = el.getBoundingClientRect().height;
      el.style.zoom = previous;
      if (natural > 0) setFitZoom(Math.max(40, Math.min(100, Math.floor(((window.innerHeight - (el.closest('main')?.getBoundingClientRect().top ?? 130) - 105) / natural) * 100))));
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', measure); };
  }, [message, objectKey, pageImg, pages, previewDark, contactName, contactNumber, buttonLabel, buttons, previewUrl, step]);

  async function saveDraft() {
    if (!destination.trim()) return toast(tr("Destination could not be detected. Enter it before continuing."),'error');
    if (!objectKey) return toast(tr("Upload an itinerary document"),'error');
    const buttonProblem = (() => {
      for (const b of buttons) {
        if (!b.text.trim()) return 'Every button needs some text';
        if (b.type === 'call' && !mobileDigits(b.phone || '')) return 'Type a valid 10-digit mobile number on the Call button, e.g. 9443146955';
        if (b.type === 'chat' && !mobileDigits(b.phone || '')) return 'Type a valid 10-digit WhatsApp number on the Chat button, e.g. 9443146955';
        if (b.type === 'url' && !/^https?:\/\/\S+\.\S+/.test((b.url || '').trim())) return 'Website buttons need a full link starting with https://';
      }
      return null;
    })();
    if (buttonProblem) return toast(buttonProblem, 'error');
    try {
      if (pkg) { const saved: any = await updatePackage.mutateAsync(payload(false)); clearDraft(); setTemplateStatus(saved?.whatsapp_template_status || 'NOT_SUBMITTED'); setTemplateReason(saved?.whatsapp_template_rejection_reason || ''); setMetaDetails(null); setCheckedAt(null); setTested(false); setStep(3); toast(tr("Saved. Now submit the template to Meta for approval."),'success'); }
      else { const created = await createPackage.mutateAsync(payload(false)); clearDraft(); toast(tr("Draft saved. Continue with the test."),'success'); router.replace(`/packages/${created.id}?stage=test`); }
    } catch(error:any) { toast(error.message || tr("Could not save draft"),'error'); }
  }

  async function activate() {
    if (!pkg) return;
    try {
      await updatePackage.mutateAsync(payload(active)); clearDraft();
      toast(active ? tr("Itinerary activated for automatic delivery") : tr("Itinerary saved inactive"),'success');
      if (active && templateStatus === 'APPROVED') {
        const status = await fetchPackageDelivery(pkg.id).catch(() => null);
        if (status && status.pending > 0 && window.confirm(`${status.pending} enquiries for this campaign have not received the itinerary yet. Send it to them now?${status.liveMode ? '' : '\n\nTest mode is ON: only approved test numbers will really receive it; the rest are skipped.'}`)) {
          const r = await sendPending.mutateAsync(pkg.id);
          toast(tr("Sent {sent}{value}{value2}", { sent: r.sent, value: r.skippedTestMode ? `, ${r.skippedTestMode} skipped (test mode)` : '', value2: r.failed ? `, ${r.failed} failed` : '' }), r.failed ? 'error' : 'success');
        }
      }
      router.push('/packages');
    }
    catch(error:any) { toast(error.message || tr("Could not save itinerary"),'error'); }
  }
  const saving = createPackage.isPending || updatePackage.isPending;
  const filteredCampaigns = (campaigns?.data || []).filter((c) => c.name.toLowerCase().includes(campaignName.trim().toLowerCase()));

  const PhonePreview = () => {
    const shownName = profile?.name || 'Errances Voyages';
    const isImageFile = /\.(jpe?g|png|webp)$/i.test(fileName);
    const isPdfFile = /\.pdf$/i.test(fileName);
    const meta = [pages ? `${pages} page${pages > 1 ? 's' : ''}` : '', isPdfFile ? 'PDF' : isImageFile ? 'Image' : 'Document', fileSize ? `${(fileSize / 1048576).toFixed(fileSize > 10485760 ? 0 : 1)} MB` : ''].filter(Boolean).join(' · ');
    const T = previewDark
      ? { frame: 'bg-[#0b141a]', head: 'bg-[#202c33]', pill: 'bg-[#182229] text-slate-400', bubble: 'bg-[#005c4b] text-white', card: 'bg-[#025144]', cardEmpty: 'bg-[#0b3d35]', ghost: 'text-white/40', dash: 'border-white/20 text-white/60', sub: 'text-white/60', body: 'text-white/85', line: 'border-white/10 hover:bg-white/5', btn: 'text-[#53bdeb]', foot: 'bg-[#202c33]', input: 'bg-[#2a3942] text-slate-400' }
      : { frame: 'bg-[#efeae2]', head: 'bg-[#075e54]', pill: 'bg-white/80 text-slate-500', bubble: 'bg-[#d9fdd3] text-slate-800', card: 'bg-white/70', cardEmpty: 'bg-slate-100', ghost: 'text-slate-400', dash: 'border-slate-400/40 text-slate-500', sub: 'text-slate-500', body: 'text-slate-700', line: 'border-black/10 hover:bg-black/5', btn: 'text-[#0a7cff]', foot: 'bg-[#f0f2f5]', input: 'bg-white text-slate-400' };
    const btn = `flex w-full items-center justify-center gap-2 border-t py-2.5 text-[13px] font-semibold ${T.line} ${T.btn}`;
    return <aside className="sticky top-2 self-start"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-navy">{tr("WhatsApp preview")}{' '}<span className="text-[11px] font-normal text-muted-foreground">{tr("· what the customer receives")}</span></p><div className="flex items-center gap-1.5"><div className="flex items-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-navy shadow-sm"><button type="button" onClick={() => { setPhoneZoom(Math.max(40, effZoom - 10)); setAutoFit(false); }} className="rounded-l-full px-2.5 py-1 hover:bg-slate-100" aria-label={tr("Zoom out")}>−</button><button type="button" onClick={() => setAutoFit(true)} className="min-w-[3.5rem] px-1 py-1 text-center hover:bg-slate-100" title={tr("Fit the whole phone on screen")}>{autoFit ? tr("Fit {effZoom}%", { effZoom: effZoom }) : `${effZoom}%`}</button><button type="button" onClick={() => { setPhoneZoom(Math.min(160, effZoom + 10)); setAutoFit(false); }} className="rounded-r-full px-2.5 py-1 hover:bg-slate-100" aria-label={tr("Zoom in")}>+</button></div><button type="button" onClick={() => setPreviewDark((v) => !v)} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-navy shadow-sm hover:border-gold">{previewDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}{previewDark ? tr("Light") : tr("Dark")}</button></div></div><div ref={phoneRef} style={{ zoom: effZoom / 100 }} className={`mx-auto w-full max-w-[24rem] overflow-hidden rounded-[2.3rem] border-[8px] border-slate-900 shadow-2xl ${T.frame}`}><div className="flex h-7 items-center justify-center bg-slate-900"><span className="h-1.5 w-20 rounded-full bg-slate-700"/></div><div className={`flex items-center gap-3 px-4 py-3 text-white ${T.head}`}>{profile?.pictureUrl ? <img src={profile.pictureUrl} alt={shownName} className="h-9 w-9 rounded-full object-cover"/> : <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-xs font-bold">{shownName.split(/\s+/).map((w: string)=>w[0]).slice(0,2).join('').toUpperCase()}</div>}<div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{shownName}</p><p className="text-[10px] text-white/70">{tr("Business Account")}</p></div><Video className="h-4 w-4"/><Phone className="h-4 w-4"/><MoreVertical className="h-4 w-4"/></div><div className="min-h-[18rem] p-3"><div className={`mx-auto mb-3 w-fit rounded-md px-2 py-1 text-[9px] ${T.pill}`}>{tr("TODAY")}</div><div className={`ml-auto max-w-[94%] overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}><div className="p-1">{objectKey ? <div className={`overflow-hidden rounded-md ${T.card}`}>{isImageFile && previewUrl ? <img src={previewUrl} alt={tr("Itinerary preview")} className="max-h-72 w-full object-cover"/> : isPdfFile && pageImg ? <img src={pageImg} alt={tr("PDF page 1")} className="max-h-60 w-full object-cover object-top"/> : <div className={`grid h-28 place-items-center ${T.cardEmpty}`}><FileText className={`h-10 w-10 ${T.ghost}`}/></div>}<div className="flex items-center gap-2.5 px-3 py-2.5"><span className="grid h-8 w-7 shrink-0 place-items-center rounded bg-red-500 text-[8px] font-bold text-white">{isPdfFile ? tr("PDF") : tr("DOC")}</span><div className="min-w-0"><p className="truncate text-[12px] font-semibold">{fileName}</p><p className={`text-[10px] ${T.sub}`}>{meta}</p></div></div></div> : <div className={`rounded-md border-2 border-dashed p-6 text-center text-xs ${T.dash}`}><Paperclip className="mx-auto mb-2 h-5 w-5"/>{tr("Document preview appears after upload.")}</div>}</div><div className="px-3 pb-1 pt-2 text-[13.5px] leading-[1.35rem]">{message.trim() ? <><p className="mb-2">{tr("Dear Mr. Ramesh,")}</p><p>{splitMessage(message)[0]}</p><p className="mt-2">{splitMessage(message)[1]}</p></> : <p>{tr("Your message appears here.")}</p>}<p className={`mt-2 text-[12.5px] ${T.body}`}>{tr("Your expert:")}{' '}<strong>{contactName.trim() || tr("Consultant name")} · {contactNumber.trim() || 'number'}</strong>{' '}{tr("— tap a button below to get in touch.")}</p><p className={`mt-1 text-right text-[10px] ${T.sub}`}>{tr("10:30 am")}{' '}<span className="text-sky-400">✓✓</span></p></div><div className="mt-1">{orderedButtons.map((b, i) => <button key={i} type="button" onClick={() => toast(b.type === 'call' ? tr("Opens the customer's phone dialer to call {value}", { value: (b.phone || contactNumber).trim() || 'this number' }) : b.type === 'url' ? tr("Opens {value} in the browser", { value: b.url || 'your link' }) : tr("Opens a WhatsApp chat with {value} and the starting message ready", { value: (b.phone || '').trim() || 'this number' }), 'success')} className={btn}>{b.type === 'call' ? <PhoneCall className="h-4 w-4"/> : b.type === 'url' ? <ExternalLink className="h-4 w-4"/> : <MessageCircle className="h-4 w-4"/>}{b.text.trim() || tr("Button")}</button>)}</div></div></div><div className={`flex gap-2 p-2 ${T.foot}`}><div className={`flex-1 rounded-full px-4 py-2 text-xs ${T.input}`}>{tr("Type a message")}</div><div className="grid h-9 w-9 place-items-center rounded-full bg-[#00a884] text-white"><Send className="h-4 w-4"/></div></div></div></aside>;
  };

  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{STEPS.map((label,index)=>{const number=index+1;const done=number<step || (number===5&&active);return <button type="button" key={label} onClick={()=>number<step&&setStep(number)} className={`rounded-xl border px-3 py-3 text-left text-xs font-bold ${number===step?'border-gold bg-gold/10 text-navy shadow-sm':done?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-slate-200 bg-slate-50 text-slate-400'}`}><span className={`mr-2 inline-grid h-5 w-5 place-items-center rounded-full ${number===step?'bg-gold text-navy':done?'bg-emerald-500 text-white':'bg-slate-200'}`}>{done?<Check className="h-3 w-3"/>:number}</span>{tr(label)}</button>})}</div>

    <div className="grid items-start gap-6" style={{gridTemplateColumns:'minmax(0, 1fr) minmax(300px, 380px)'}}>
      <section className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        {step===1 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Stage 1 of 5")}</p><h2 className="mt-2 text-2xl font-bold text-navy">{tr("Select Meta campaign")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("Destination and itinerary name will fill automatically from the campaign.")}</p></div><div><div className="flex items-center justify-between"><Label>{tr("Meta campaign *")}</Label><button type="button" onClick={()=>refetch()} className="flex items-center gap-1 text-xs font-semibold text-gold"><RefreshCw className={`h-3.5 w-3.5 ${isFetching?'animate-spin':''}`}/>{tr("Refresh")}</button></div><div className="relative mt-2"><Input value={campaignName} onChange={(e)=>{setCampaignName(e.target.value);setCampaignOpen(true)}} onFocus={()=>setCampaignOpen(true)} onBlur={()=>setTimeout(()=>setCampaignOpen(false),150)} placeholder={tr("Type to search campaigns, e.g. Kashmir")} className="h-12 w-full text-sm"/>{campaignOpen&&(campaignsLoading?<div className="absolute z-10 mt-1 w-full rounded-xl border border-input bg-background p-3 text-xs text-muted-foreground shadow-lg">{tr("Loading campaigns…")}</div>:filteredCampaigns.length>0?<div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-input bg-background shadow-lg">{filteredCampaigns.map(c=><button type="button" key={c.id} onMouseDown={()=>{setCampaignName(c.name);setCampaignOpen(false)}} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-gold/10"><span className="truncate">{c.name}</span><span className="shrink-0 text-xs text-muted-foreground">{c.effective_status||tr(c.status)}</span></button>)}</div>:<div className="absolute z-10 mt-1 w-full rounded-xl border border-input bg-background p-3 text-xs text-muted-foreground shadow-lg">{tr("No campaigns match \"")}{campaignName}&quot;.</div>)}</div></div><div className="flex justify-end"><Button type="button" variant="gold" disabled={!campaignName} onClick={()=>setStep(2)} className="gap-2">{tr("Next: Content & Upload")}{' '}<ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===2 && <><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Stage 2 of 5")}</p><h2 className="mt-2 text-2xl font-bold text-navy">{tr("Content & itinerary")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("Campaign details are filled automatically. Upload and preview before saving.")}</p></div><Button type="button" variant="gold" disabled={saving||uploading||!objectKey} onClick={saveDraft}>{saving?tr("Saving…"):tr("Save & continue")}</Button></div><SetupPicker items={byKind('setup')} onApply={applySetup} onSaveCurrent={saveSetup} actions={{ update: (id, value) => presetActions.update.mutate({ id, value }), remove: (id) => presetActions.remove.mutate(id) }}/><div className="grid gap-4 sm:grid-cols-2"><div><Label>{tr("Destination *")}</Label><Input className="mt-1.5" value={destination} onChange={e=>setDestination(e.target.value)} list="destinations"/><datalist id="destinations">{DESTINATIONS.map(d=><option key={d}>{tr(d)}</option>)}</datalist></div><div><Label>{tr("Duration *")}</Label><div className="mt-1.5 flex items-center gap-2"><select value={days} onChange={e=>{const d=e.target.value;const n=d?String(Math.max(Number(d)-1,0)):'';setDays(d);setNights(n);if(destination&&(!name||name.startsWith(destination)))setName(`${destination} ${durationLabel(d,n)} Itinerary`.replace(/\s+/g,' '));}} className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"><option value="">{tr("Days")}</option>{Array.from({length:21},(_,i)=>i+1).map(v=><option key={v} value={v}>{tr(v)}{' '}{tr("Day")}{v>1?'s':''}</option>)}</select><select value={nights} onChange={e=>{const n=e.target.value;setNights(n);if(destination&&(!name||name.startsWith(destination)))setName(`${destination} ${durationLabel(days,n)} Itinerary`.replace(/\s+/g,' '));}} className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"><option value="">{tr("Nights")}</option>{Array.from({length:21},(_,i)=>i).map(v=><option key={v} value={v}>{tr(v)}{' '}{tr("Night")}{v===1?'':'s'}</option>)}</select></div></div><div><Label>{tr("Display name")}</Label><Input className="mt-1.5" value={name} onChange={e=>setName(e.target.value)}/></div><div><Label>{tr("Consultant name")}</Label><PresetField items={byKind('name')} value={contactName} onChange={setContactName} actions={listActions('name')} placeholder={tr("e.g. Aarav")}/></div></div><div><Label>{tr("WhatsApp introduction message")}</Label><MessageTemplatePicker items={byKind('message')} actions={listActions('message')} onPick={(t)=>{setTemplate(t);setMessageEdited(false);setMessage(fillTemplate(t,destination));}} onSaveCurrent={()=>{const v=destination?message.replace(new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'{destination}'):message;if(v.trim())presetActions.add.mutate({kind:'message',value:v.trim()});}}/><textarea rows={5} value={message} onChange={e=>{setMessage(e.target.value);setMessageEdited(true)}} className="mt-1.5 w-full rounded-xl border border-input p-3 text-sm outline-none focus:border-gold"/></div><div className="rounded-xl border border-gold/30 bg-gold/5 p-4"><p className="text-sm font-bold text-navy">{tr("Buttons under the message")}</p>
          {buttons.map((b, i) => <div key={i} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 shadow-sm"><span className="w-[4.5rem] shrink-0 rounded-full bg-slate-100 px-2 py-1 text-center text-[11px] font-bold uppercase text-slate-600">{b.type === 'call' ? tr("Call") : b.type === 'url' ? tr("Website") : tr("Chat")}</span><div className="min-w-[8rem] flex-1"><PresetField className="!mt-0" items={byKind('button')} value={b.text} maxLength={25} onChange={(v) => updateButton(i, { text: v })} actions={listActions('button')} placeholder={tr("Button text")}/></div>{b.type === 'call' && <div className="min-w-[11rem] flex-1"><PresetField className="!mt-0" items={byKind('number')} value={b.phone || ''} inputMode="tel" onChange={(v) => updateButton(i, { phone: v })} actions={listActions('number')} placeholder={tr("Number to call, e.g. 9443146955")}/>{b.phone?.trim() && !mobileDigits(b.phone) && <p className="mt-1 text-[11px] font-semibold text-red-600">{tr("Not a valid 10-digit Indian mobile number")}</p>}</div>}{b.type === 'url' && <div className="min-w-[11rem] flex-1"><PresetField className="!mt-0" items={byKind('link')} value={b.url || ''} onChange={(v) => updateButton(i, { url: v })} actions={listActions('link')} placeholder={tr("https://your-website.com/page")}/></div>}{b.type === 'chat' && <div className="min-w-[11rem] flex-1"><PresetField className="!mt-0" items={byKind('number')} value={b.phone || ''} inputMode="tel" onChange={(v) => updateButton(i, { phone: v, replyTouched: true })} actions={listActions('number')} placeholder={tr("WhatsApp number to chat (follows the Call number)")}/>{b.phone?.trim() && !mobileDigits(b.phone) && <p className="mt-1 text-[11px] font-semibold text-red-600">{tr("Not a valid 10-digit Indian mobile number")}</p>}</div>}{b.type === 'chat' && <div className="w-full min-w-[11rem] pl-[4.75rem]"><PresetField className="!mt-0" items={byKind('reply')} value={b.reply ?? ''} onChange={(v) => updateButton(i, { reply: v })} actions={listActions('reply')} placeholder={tr("Message they start with, e.g. Hi, I am interested to know more about {destination}")}/></div>}<button type="button" onClick={() => setButtons((list) => list.filter((_, idx) => idx !== i))} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label={tr("Remove button")}><X className="h-4 w-4"/></button></div>)}
          {!buttons.length && <p className="mt-2 text-xs text-muted-foreground">{tr("No buttons — the message goes out with text and document only.")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={buttonCounts.call >= 1} onClick={() => setButtons((list) => [...list, { type: 'call', text: 'Call our experts', phone: '' }])} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold disabled:opacity-40">{tr("+ Call")}</button>
            <button type="button" disabled={buttonCounts.url + buttonCounts.chat >= 2} onClick={() => setButtons((list) => [...list, { type: 'url', text: 'Visit website', url: '' }])} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold disabled:opacity-40">{tr("+ Website link")}</button>
            <button type="button" disabled={buttonCounts.url + buttonCounts.chat >= 2} onClick={() => setButtons((list) => [...list, { type: 'chat', text: 'Chat with us', phone: list.find((x) => x.type === 'call')?.phone || '', reply: 'Hi, I am interested to know more about {destination}' }])} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold disabled:opacity-40">{tr("+ Chat")}</button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{tr("Call opens the phone dialer with its number. Chat opens a WhatsApp chat with its number and the starting message already typed (")}{destination}{' '}{tr("becomes the place name); the number follows the Call number until you change it, so chats can go to any sales person, with no new approval needed for the number or message. Website opens a link. Up to 1 call and 2 chat/website buttons; text up to 25 characters. Changing a button’s text, call number or website link needs a new one-time Meta approval.")}</p></div><div><Label>{tr("Itinerary document *")}</Label>{objectKey?<div className="mt-2 flex items-center gap-3 rounded-xl border border-gold/30 bg-gold/5 p-4"><FileText className="h-8 w-8 text-gold"/><span className="min-w-0 flex-1 truncate text-sm font-semibold">{fileName}</span><button type="button" onClick={()=>{setObjectKey('');setFileName('')}}><X className="h-4 w-4"/></button></div>:<label className="mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gold/40 bg-gold/5 p-8"><Upload className="h-8 w-8 text-gold"/><span className="text-sm font-semibold">{uploading?tr("Uploading…"):tr("Choose itinerary file")}</span>{uploading && progress && <div className="w-full max-w-xs"><div className="h-2 overflow-hidden rounded-full bg-gold/20"><div className="h-full rounded-full bg-gold transition-all" style={{width:`${Math.min(100,Math.round(progress.loaded/progress.total*100))}%`}}/></div><p className="mt-1 text-center text-xs font-semibold text-navy">{(progress.loaded/1048576).toFixed(1)}{' '}{tr("MB of")}{' '}{(progress.total/1048576).toFixed(1)}{' '}{tr("MB ·")}{' '}{Math.min(100,Math.round(progress.loaded/progress.total*100))}%</p></div>}<input type="file" hidden disabled={uploading} onChange={upload}/></label>}</div><div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(1)} className="gap-2"><ChevronLeft className="h-4 w-4"/>{tr("Back")}</Button><Button type="button" variant="gold" disabled={saving||uploading||!objectKey} onClick={saveDraft} className="gap-2">{saving?tr("Saving…"):tr("Save & continue")} <ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===3 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Stage 3 of 5")}</p><h2 className="mt-2 text-2xl font-bold text-navy">{tr("Meta approval")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("WhatsApp only allows business messages with buttons after Meta approves the template. Submit it here and watch the status — testing unlocks once it is approved.")}</p></div>{!pkg?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">{tr("Save the previous stage first to create the template.")}</p>:<>
          <CampaignItineraries campaignName={campaignName} currentId={pkg.id} destination={destination}/>
          <div className="rounded-xl border border-slate-200 p-5"><div className="flex items-start">{[
            { label:'Submitted to Meta', state: templateStatus==='NOT_SUBMITTED' ? 'todo' : 'done' },
            { label:'Meta review', state: templateStatus==='NOT_SUBMITTED' ? 'todo' : templateStatus==='PENDING' ? 'active' : 'done' },
            { label: templateStatus==='REJECTED' ? 'Rejected' : templateStatus==='APPROVED' ? 'Approved' : 'Approval', state: templateStatus==='APPROVED' ? 'done' : templateStatus==='REJECTED' ? 'bad' : 'todo' },
          ].map((item, index, all)=><div key={item.label} className="flex flex-1 flex-col items-center text-center"><div className="flex w-full items-center"><div className={`h-1 flex-1 ${index===0?'opacity-0':item.state==='todo'?'bg-slate-200':item.state==='bad'?'bg-red-400':'bg-emerald-500'}`}/><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${item.state==='done'?'bg-emerald-500':item.state==='bad'?'bg-red-500':item.state==='active'?'bg-amber-500 animate-pulse':'bg-slate-300'}`}>{item.state==='done'?<Check className="h-4 w-4"/>:item.state==='bad'?<X className="h-4 w-4"/>:index+1}</div><div className={`h-1 flex-1 ${index===all.length-1?'opacity-0':all[index+1].state==='todo'?'bg-slate-200':all[index+1].state==='bad'?'bg-red-400':'bg-emerald-500'}`}/></div><p className="mt-2 text-xs font-semibold text-navy">{tr(item.label)}</p></div>)}</div></div>
          <div className={`rounded-xl border p-5 ${templateStatus==='APPROVED'?'border-emerald-200 bg-emerald-50':templateStatus==='REJECTED'?'border-red-200 bg-red-50':templateStatus==='NOT_SUBMITTED'?'border-slate-200 bg-slate-50':'border-amber-200 bg-amber-50'}`}>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tr("What Meta says")}</p>
            <p className="mt-1 text-lg font-bold text-navy">{templateStatus==='APPROVED'?tr("Approved ✓"):templateStatus==='REJECTED'?tr("Rejected"):templateStatus==='PENDING'?tr("In review"):templateStatus==='NOT_SUBMITTED'?tr("Not submitted yet"):templateStatus.replace(/_/g,' ')}</p>
            <p className="mt-1 text-sm text-slate-700">{templateStatus==='APPROVED'?tr("Your template is approved. Go to the next stage to send a test message."):templateStatus==='REJECTED'?(templateReason||tr("Meta rejected this template without a detailed reason.")):templateStatus==='PENDING'?tr("Meta is reviewing the template. This usually takes a few minutes and up to 24 hours. This page checks automatically every 20 seconds."):templateStatus==='NOT_SUBMITTED'?tr("Submit the template to start Meta’s review."):(templateReason||tr("Check the template in Meta Business Manager."))}</p>
            {templateStatus==='REJECTED' && <p className="mt-2 text-xs text-muted-foreground">{tr("Change the wording or number in the previous stage, save, and submit again.")}</p>}
            {checkedAt && <p className="mt-2 text-[11px] text-muted-foreground">{tr("Last checked")}{' '}{checkedAt.toLocaleTimeString(locale())}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {(templateStatus==='NOT_SUBMITTED'||templateStatus==='REJECTED') && <Button type="button" variant="gold" disabled={submitTemplate.isPending} onClick={()=>submitTemplate.mutateAsync(pkg.id).then((result)=>{setTemplateStatus(result.whatsapp_template_status);setTemplateReason(result.whatsapp_template_rejection_reason||'');setCheckedAt(new Date());checkApproval();toast(result.whatsapp_template_status==='APPROVED'?tr("Template approved"):tr("Submitted to Meta for review"),'success')}).catch((e:any)=>toast(e.message||tr("Template submission failed"),'error'))}>{submitTemplate.isPending?tr("Submitting…"):templateStatus==='REJECTED'?tr("Submit again"):tr("Submit to Meta for approval")}</Button>}
              {templateStatus!=='NOT_SUBMITTED' && templateStatus!=='APPROVED' && <Button type="button" variant="outline" disabled={syncTemplate.isPending} onClick={()=>checkApproval(true)}><RefreshCw className={`mr-2 h-4 w-4 ${syncTemplate.isPending?'animate-spin':''}`}/>{tr("Check now")}</Button>}
            </div>
          </div>
          {templateStatus!=='NOT_SUBMITTED' && (() => {
            const reasonText: Record<string,string> = { INCORRECT_CATEGORY:'Meta thinks the message is a different category than declared (for example promotional wording in a utility template).', INVALID_FORMAT:'The template layout or variables are not in an allowed format (for example a variable at the start or end, or too many variables for the length).', ABUSIVE_CONTENT:'Meta flagged the wording as abusive or inappropriate.', SCAM:'Meta flagged the content as possibly misleading or a scam.', TAG_CONTENT_MISMATCH:'The content does not match the template type chosen.' };
            const quality: Record<string,string> = { GREEN:'High — customers respond well', YELLOW:'Medium', RED:'Low — customers are blocking or reporting', UNKNOWN:'Not rated yet (needs some sends)' };
            const rows: [string,string][] = [
              ['Template name', metaDetails?.name || pkg?.whatsapp_template_name || '—'],
              ['Category', metaDetails?.category ? `${metaDetails.category}${metaDetails.category==='MARKETING'?' (promotional — billed per delivered conversation)':''}` : '—'],
              ['Language', metaDetails?.language || 'en_US'],
              ['Quality rating', metaDetails?.quality ? (quality[metaDetails.quality] || metaDetails.quality) : 'Not rated yet'],
              ['Meta last updated', metaDetails?.last_updated ? new Date(Number(metaDetails.last_updated) * 1000 || metaDetails.last_updated).toLocaleString(locale()) : '—'],
            ];
            return <div className="rounded-xl border border-slate-200 p-4 text-xs"><p className="font-semibold text-navy">{tr("Meta template details")}</p><dl className="mt-2 grid grid-cols-[9rem_1fr] gap-y-1.5">{rows.map(([k,v])=><div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium text-slate-800">{v}</dd></div>)}</dl>
              <div className={`mt-3 rounded-lg p-3 ${templateStatus==='APPROVED'?'bg-emerald-50 text-emerald-800':templateStatus==='REJECTED'?'bg-red-50 text-red-800':'bg-amber-50 text-amber-800'}`}>
                {templateStatus==='APPROVED' && <><p className="font-semibold">{tr("Why it is approved")}</p><p className="mt-1">{tr("Meta reviews templates automatically against its messaging policy. This one passed: the wording is not misleading, the variables are laid out correctly, and the call and call-back buttons are in an allowed format.")}</p></>}
                {templateStatus==='REJECTED' && <><p className="font-semibold">{tr("Why it was rejected")}</p><p className="mt-1">{metaDetails?.rejected_reason ? (reasonText[metaDetails.rejected_reason] || metaDetails.rejected_reason) : (templateReason || tr("Meta did not give a reason. Open WhatsApp Manager → Message templates to see its note."))}</p>{metaDetails?.rejected_reason && <p className="mt-1 opacity-80">{tr("Meta code:")}{' '}{metaDetails.rejected_reason}</p>}<p className="mt-1">{tr("Edit the message in Stage 2, save, and submit again.")}</p></>}
                {templateStatus!=='APPROVED' && templateStatus!=='REJECTED' && <><p className="font-semibold">{tr("Why it is not approved yet")}</p><p className="mt-1">{tr("Meta is still reviewing it. Most templates are decided within minutes; some take up to 24 hours. Nothing is wrong with it yet.")}</p></>}
              </div></div>;
          })()}
          <div className="rounded-xl border border-slate-200 p-4 text-xs text-slate-600"><p className="font-semibold text-navy">{tr("Submitted template")}</p><p className="mt-1">{tr("Document · your message ·")}{' '}<strong>{contactName.trim() || tr("Consultant")}</strong> · {contactNumber.trim()}</p><p className="mt-1">{tr("Buttons:")}{' '}<strong>{orderedButtons.map((b) => b.text).join(' · ') || 'none'}</strong></p></div>
        </>}<div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(2)} className="gap-2"><ChevronLeft className="h-4 w-4"/>{tr("Back")}</Button><Button type="button" variant="gold" disabled={templateStatus!=='APPROVED'} onClick={()=>setStep(4)} className="gap-2">{templateStatus==='APPROVED'?tr("Next: Test message"):tr("Waiting for approval…")} <ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===4 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Stage 4 of 5")}</p><h2 className="mt-2 text-2xl font-bold text-navy">{tr("Test message")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("Send the approved message to one of your test numbers and check how it looks on the phone: document, text and both buttons.")}</p></div>{pkg && templateStatus==='APPROVED' ? <><div><Label>{tr("Test number")}</Label><PresetField items={testList.map((n)=>({ id:n, kind:'number' as const, value:n }))} value={testNumber} onChange={setTestNumber} actions={testActions} inputMode="tel" placeholder={tr("Type any number, e.g. 9443146955")}/><p className="mt-1 text-xs text-muted-foreground">{tr("Type a number and press “Add … to list” to save it, or pick one you saved. Edit or delete saved numbers with the icons. Sending to a new number adds it automatically.")}</p></div><Button type="button" className="w-full gap-2" disabled={!testNumber.trim()||sendTest.isPending||updateTestNumbers.isPending} onClick={()=>sendTestMessage()}><Send className="h-4 w-4"/>{sendTest.isPending?tr("Sending…"):tr("Send test message")}</Button>{tested&&<p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{tr("✓ Test accepted by WhatsApp. Check the phone, then continue.")}</p>}</> : <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">{tr("Testing unlocks after Meta approves the template (previous stage).")}</p>}<div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(3)} className="gap-2"><ChevronLeft className="h-4 w-4"/>{tr("Back")}</Button><Button type="button" variant="gold" disabled={templateStatus!=='APPROVED'} onClick={()=>setStep(5)} className="gap-2">{tr("Next: Activate")}{' '}<ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===5 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">{tr("Stage 5 of 5")}</p><h2 className="mt-2 text-2xl font-bold text-navy">{tr("Activate automation")}</h2><p className="mt-1 text-sm text-muted-foreground">{tr("One switch, one action: turning it on saves and immediately sends to every matching enquiry that hasn't received it yet; turning it off stops automatic sending.")}</p></div><div className={`flex items-center justify-between rounded-xl border p-5 ${pkg?.is_active?'border-emerald-200 bg-emerald-50':'border-slate-200'}`}><div><p className="font-bold">{tr("Automatic WhatsApp delivery")}</p><p className="mt-1 text-xs text-muted-foreground">{tr("Campaign:")}{' '}{campaignName}</p></div>{pkg ? <ActiveSwitch pkg={pkg} /> : <p className="text-xs text-muted-foreground">{tr("Save this itinerary first (Stage 2) to activate it.")}</p>}</div><div className="rounded-xl border border-slate-200 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-navy">{tr("Enquiries for this campaign")}</p><p className="text-xs text-muted-foreground">{delivery ? (delivery.campaign ? tr("Campaign: {campaign}", { campaign: delivery.campaign }) : tr("Destination: {destination}", { destination: delivery.destination })) : tr("Checking…")}</p></div>{delivery && <div className="flex gap-2 text-center text-xs"><div className="rounded-lg bg-slate-100 px-3 py-1.5"><p className="text-base font-bold text-navy">{delivery.total}</p>{tr("enquiries")}</div><div className="rounded-lg bg-emerald-50 px-3 py-1.5"><p className="text-base font-bold text-emerald-700">{delivery.sent}</p>{tr("sent")}</div><div className="rounded-lg bg-amber-50 px-3 py-1.5"><p className="text-base font-bold text-amber-700">{delivery.pending}</p>{tr("not sent")}</div></div>}</div>
            {delivery && delivery.leads.length > 0 && <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-100">{delivery.leads.map((lead) => <div key={lead.id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-0"><div className="min-w-0"><p className="truncate font-semibold text-navy">{lead.name}</p><p className="truncate text-muted-foreground">{lead.phone || tr("No number")}{lead.enquiry ? ` · ${lead.enquiry}` : ''}</p></div><span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${lead.sent ? 'bg-emerald-100 text-emerald-700' : lead.validPhone ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{lead.sent ? tr("Sent {value}", { value: lead.sentAt ? new Date(lead.sentAt).toLocaleDateString(locale()) : '' }) : lead.validPhone ? tr("Not sent") : tr("No valid number")}</span></div>)}</div>}
            {delivery && delivery.total === 0 && <p className="mt-3 text-xs text-muted-foreground">{tr("No enquiries match this campaign yet. New ones get the itinerary automatically.")}</p>}
            {delivery && delivery.pending > 0 && <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="gold" disabled={!pkg?.is_active || templateStatus !== 'APPROVED' || sendPending.isPending} onClick={sendBacklog}>{sendPending.isPending ? tr("Sending…") : tr("Send to {pending} enquiries not sent", { pending: delivery.pending })}</Button><p className="text-xs text-muted-foreground">{!pkg?.is_active ? tr("Activate the itinerary first, then send.") : delivery.liveMode ? tr("Live mode: real customers will receive it.") : tr("Test mode is ON: only approved test numbers really receive it; others are skipped.")}</p></div>}
          </div>
          <div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(4)} className="gap-2"><ChevronLeft className="h-4 w-4"/>{tr("Back")}</Button><Button type="button" variant="gold" onClick={()=>router.push('/packages')}>{tr("Done")}</Button></div></>}
      </section>
      <PhonePreview/>
    </div>
  </div>;
}






const STATUS_STYLE: Record<string, string> = { APPROVED: 'bg-emerald-100 text-emerald-700', PENDING: 'bg-amber-100 text-amber-700', REJECTED: 'bg-red-100 text-red-700', NOT_SUBMITTED: 'bg-slate-100 text-slate-600' };
const STATUS_LABEL: Record<string, string> = { APPROVED: 'Approved', PENDING: 'In review', REJECTED: 'Rejected', NOT_SUBMITTED: 'Not submitted' };

// Every itinerary sharing this campaign (e.g. Vietnam 5D/4N and Vietnam 2D/1N) with its own Meta
// approval, so both templates can be watched in one place. Each is sent as its own message.
function CampaignItineraries({ campaignName, currentId, destination }: { campaignName: string; currentId: string; destination: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data } = usePackages();
  const sync = useSyncItineraryTemplate();
  const [checking, setChecking] = useState(false);
  const siblings = (data?.data ?? []).filter((p: any) => !p.is_deleted && campaignName && p.campaign_name === campaignName);
  const status = (p: any) => p.whatsapp_template_status || 'NOT_SUBMITTED';
  const approved = siblings.filter((p: any) => status(p) === 'APPROVED').length;
  if (siblings.length < 1) return null;

  async function checkAll() {
    setChecking(true);
    try { for (const p of siblings) { if (status(p) !== 'NOT_SUBMITTED') await sync.mutateAsync(p.id).catch(() => undefined); } toast(tr("Checked Meta for every itinerary"), 'success'); }
    finally { setChecking(false); }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-bold text-navy">{tr("Itineraries for this campaign")}</p><p className="text-xs text-muted-foreground">{siblings.length === 1 ? tr("One itinerary.") : tr("Customers get all {length}, one message each.", { length: siblings.length })} {approved === siblings.length ? tr("All approved — ready to send.") : tr("{approved} of {length} approved.", { approved: approved, length: siblings.length })}</p></div>
        <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={checking} onClick={checkAll}>{checking ? tr("Checking…") : tr("Check all with Meta")}</Button><Button type="button" variant="gold" size="sm" onClick={() => router.push(`/packages/new?another=1&campaign=${encodeURIComponent(campaignName)}&destination=${encodeURIComponent(destination)}`)}>{tr("+ Add another itinerary")}</Button></div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(approved / siblings.length) * 100}%` }} /></div>
      <div className="mt-3 divide-y rounded-lg border">
        {siblings.map((p: any) => (
          <div key={p.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${p.id === currentId ? 'bg-gold/10' : ''}`}>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-navy">{p.name}{p.id === currentId && <span className="ml-2 text-[11px] font-bold text-gold">{tr("this one")}</span>}</p><p className="text-xs text-muted-foreground">{p.duration_days ? tr("{duration_days} Days / {value} Nights", { duration_days: p.duration_days, value: p.duration_nights ?? 0 }) : tr("Duration not set")}{p.itinerary_pdf_file_name ? ` · ${p.itinerary_pdf_file_name}` : ''}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[status(p)] || STATUS_STYLE.NOT_SUBMITTED}`}>{tr(STATUS_LABEL[status(p)]) || status(p)}</span>
            {p.id !== currentId && <button type="button" onClick={() => router.push(`/packages/${p.id}`)} className="text-xs font-semibold text-navy underline">{tr("Open")}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
