'use client';
import { waNumber } from '@/lib/utils';

import Link from 'next/link';
import { renderPdfFirstPage } from '@/lib/pdf-thumb';
import { MessageTemplatePicker, PresetField } from './preset-field';
import { ActiveSwitch } from './active-switch';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Eye, FileText, Info, List, MoreVertical, Paperclip, Moon, Plus, Sun, Phone, ExternalLink, MessageCircle, PhoneCall, RefreshCw, Send, Upload, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { usePackages, fetchPackageDocumentBytes, getPackageDocumentPreview, useCreatePackage, useItineraryPresetActions, useItineraryPresets, useMetaCampaigns, useUpdatePackage, uploadPackageDocument, usePackageDocuments, useAddPackageDocument, useUpdatePackageDocument, useDeletePackageDocument, PackageDocument } from '@/hooks/use-packages';
import { api } from '@/lib/api-client';
import { useSendTestItinerary, useSubmitItineraryTemplate, useSubmitDocumentTemplate, useSyncItineraryTemplate, useSyncDocumentTemplate, fetchPackageDelivery, savePackageThumbnail, usePackageDelivery, useSendPendingItinerary, useUpdateTestNumbers, useWhatsAppAutomation, useWhatsAppProfile } from '@/hooks/use-whatsapp';
import { PackageButton, TourPackage } from '@/types/package';

import { DESTINATIONS } from '@/lib/destinations';

// A quick "does this PDF still look right?" without downloading it first -- fetches a
// short-lived viewing link (R2 objects aren't publicly readable) and opens it in a new tab.
async function viewDocument(objectKey: string | null | undefined) {
  if (!objectKey) return;
  try {
    const { url } = await api.get<{ url: string }>(`/files/presign-download?objectKey=${encodeURIComponent(objectKey)}`);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // Silent -- worst case nothing opens.
  }
}
// Two itineraries with the exact same Days/Nights look identical to a customer in the duration
// list ("2D/1N" twice) -- not blocked (a forced duplicate might be intentional, e.g. two
// itineraries covering different places in the same duration), but the 2nd+ occurrence gets
// "(Option 2)" etc. appended so it's at least distinguishable, both here and in the real send
// (see the matching logic in sendDurationOptionsList on the backend).
function labelDurationOptions<T extends { days: string; nights: string }>(items: T[]): (T & { label: string; isDuplicate: boolean; duplicateOfOption: number | null })[] {
  const firstSeenAt: Record<string, number> = {};
  return items.map((it, idx) => {
    const sig = `${it.nights}N${it.days}D`;
    const firstIdx = firstSeenAt[sig];
    if (firstIdx === undefined) firstSeenAt[sig] = idx;
    return { ...it, label: ((n, d) => (Number(n) > 0 ? `${n} Night${Number(n) === 1 ? '' : 's'} / ${d} Day${Number(d) === 1 ? '' : 's'}` : `${d} Day${Number(d) === 1 ? '' : 's'}`))(it.nights, it.days), isDuplicate: firstIdx !== undefined, duplicateOfOption: firstIdx !== undefined ? firstIdx + 1 : null };
  });
}

// Words every campaign name shares (agency prefix, filler, dates), stripped so
// whatever remains is a reasonable guess at the destination for a campaign whose
// place isn't in DESTINATIONS above -- better than leaving the field blank.
const CAMPAIGN_BOILERPLATE = /\b(smm|socialmm|trt|high|intent|traveller|travellers|package|packages|leads?|lead\s*form|trichy|errance|rasi|travels?|tour|tours|itinerary|2025|2026|2027|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/gi;
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

// A themed combo: click to open a compact scrollable list (matching PresetField's look), or
// type straight into the box at the top of the panel. Replaces the native number+datalist
// combo, which rendered a plain unstyled overlay and silently dropped non-numeric keystrokes.
function NumberPicker({ value, onChange, max = 30, placeholder, highlight }: { value: string; onChange: (v: string) => void; max?: number; placeholder: string; highlight?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Opened near the bottom of the screen, the list used to hang off the edge -- bring the whole
  // list into view instead.
  useEffect(() => { if (open) requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`flex h-9 w-[6.5rem] items-center justify-between rounded-lg border bg-white px-2.5 text-sm shadow-sm hover:border-gold ${highlight && !value ? 'border-red-400 ring-1 ring-red-200' : 'border-input'}`}>
        <span className={value ? 'font-medium text-navy' : highlight ? 'font-semibold text-red-500' : 'text-muted-foreground'}>{value !== '' ? `${value} ${placeholder}` : placeholder}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${highlight && !value ? 'text-red-400' : 'text-muted-foreground'}`} />
      </button>
      {open && (
        <div ref={listRef} className="absolute z-20 mt-1 max-h-56 w-24 scroll-mb-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <input type="number" min={0} max={max} autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mb-1 h-8 w-full rounded-md border border-input px-2 text-sm outline-none focus:border-gold" />
          {Array.from({ length: max + 1 }, (_, v) => v).map((v) => (
            <button key={v} type="button" onClick={() => { onChange(String(v)); setOpen(false); }} className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${value === String(v) ? 'bg-gold/20 font-semibold text-navy' : 'text-slate-700 hover:bg-gold/10'}`}>{v}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Pick up to `max` saved test numbers (checkboxes), type+add a new one, and manage saved
// numbers (edit/delete) via a per-row "⋮" menu instead of inline icons, per explicit request
// to keep the row itself clean.
const MAX_TEST_NUMBERS = 4;
function TestNumbersPicker({ list, selected, onToggle, onAdd, onUpdate, onRemove }: {
  list: string[]; selected: string[]; onToggle: (n: string) => void;
  onAdd: (n: string) => void; onUpdate: (oldN: string, newN: string) => void; onRemove: (n: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setMenuFor(null); setEditing(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  function addDraft() {
    const digits = draft.replace(/\D/g, '');
    const n = digits.length === 10 ? `91${digits}` : digits;
    if (n.length < 11) return;
    onAdd(n);
    setDraft('');
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 py-1.5 text-sm shadow-sm hover:border-gold">
        {selected.length === 0 && <span className="text-muted-foreground">Select up to {MAX_TEST_NUMBERS} test numbers…</span>}
        {selected.map((n) => (
          <span key={n} className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-navy">
            {n}
            <X className="h-3 w-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); onToggle(n); }} />
          </span>
        ))}
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[16rem] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="mb-1.5 flex gap-1.5">
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }} inputMode="tel" placeholder="Type a new number…" className="h-8 flex-1 rounded-md border border-input px-2 text-sm outline-none focus:border-gold" />
            <Button type="button" size="sm" variant="outline" onClick={addDraft} disabled={!draft.trim()}>Add</Button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {list.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">No saved test numbers yet.</p>}
            {list.map((n) => (
              <div key={n} className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-gold/5">
                {editing === n ? (
                  <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { onUpdate(n, editValue); setEditing(null); } if (e.key === 'Escape') setEditing(null); }} onBlur={() => { if (editValue.trim() && editValue !== n) onUpdate(n, editValue); setEditing(null); }} className="h-7 flex-1 rounded-md border border-gold px-2 text-sm outline-none" />
                ) : (
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={selected.includes(n)} disabled={!selected.includes(n) && selected.length >= MAX_TEST_NUMBERS} onChange={() => onToggle(n)} className="h-3.5 w-3.5 accent-gold" />
                    {n}
                  </label>
                )}
                <div className="relative">
                  <button type="button" onClick={() => setMenuFor((v) => (v === n ? null : n))} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy" aria-label="More options">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {menuFor === n && (
                    <div className="absolute right-0 z-30 mt-1 w-28 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                      <button type="button" onClick={() => { setEditing(n); setEditValue(n); setMenuFor(null); }} className="block w-full px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-gold/10">Edit</button>
                      <button type="button" onClick={() => { onRemove(n); setMenuFor(null); }} className="block w-full px-3 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {selected.length >= MAX_TEST_NUMBERS && <p className="mt-1 px-1 text-[11px] text-amber-600">Maximum {MAX_TEST_NUMBERS} numbers selected.</p>}
        </div>
      )}
    </div>
  );
}

export function PackageForm({ pkg }: { pkg?: TourPackage }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const createPackage = useCreatePackage();
  const updatePackage = useUpdatePackage(pkg?.id ?? '');
  const { data: campaigns, isLoading: campaignsLoading, refetch, isFetching } = useMetaCampaigns();
  const { data: allPackages } = usePackages();
  const { data: automation } = useWhatsAppAutomation();
  const { data: profile } = useWhatsAppProfile();
  const updateTestNumbers = useUpdateTestNumbers();
  const sendPending = useSendPendingItinerary();
  const sendTest = useSendTestItinerary();
  const submitTemplate = useSubmitItineraryTemplate();
  const syncTemplate = useSyncItineraryTemplate();
  const documentsQuery = usePackageDocuments(pkg?.id);
  const documents = documentsQuery.data ?? [];
  const addDocument = useAddPackageDocument(pkg?.id ?? '');
  const updateDocument = useUpdatePackageDocument(pkg?.id ?? '');
  const deleteDocument = useDeletePackageDocument(pkg?.id ?? '');
  const submitDocTemplate = useSubmitDocumentTemplate(pkg?.id ?? '');
  const syncDocTemplate = useSyncDocumentTemplate(pkg?.id ?? '');
  const allDocsApproved = documents.every((d) => d.whatsapp_template_status === 'APPROVED');
  const stageParam = params.get('stage');
  const initialStage = stageParam === 'activate' ? 5 : stageParam === 'try' ? 4 : stageParam === 'test' || stageParam === 'approval' ? 3 : stageParam === 'content' ? 2 : 1;
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
  // "Next: Test message" used to only check THIS package's own templates -- a sibling itinerary
  // in the same campaign (e.g. a 2D/1N and a 5D/4N for the same destination, each its own
  // message a customer gets) could still be sitting un-approved and the button would light up
  // anyway, letting staff believe the whole campaign was ready when it wasn't ("not submitted
  // ... should not be happening ... it should not lead me to the test"). Now every sibling has
  // to be approved too, matching what the "Itineraries for this campaign" panel already shows.
  const campaignSiblings = (allPackages?.data ?? []).filter((p: any) => !p.is_deleted && campaignName && p.campaign_name === campaignName);
  const allCampaignApproved = campaignSiblings.every((p: any) => (p.whatsapp_template_status || 'NOT_SUBMITTED') === 'APPROVED');
  const [destination, setDestination] = useState<string>(draft.destination ?? pkg?.destinations?.[0] ?? params.get('destination') ?? '');
  const [days, setDays] = useState<string>(String(draft.days ?? pkg?.duration_days ?? ''));
  const [nights, setNights] = useState<string>(String(draft.nights ?? pkg?.duration_nights ?? ''));
  const durationLabel = (d: string, n: string) => (d ? `${d} Day${d === '1' ? '' : 's'}${n !== '' ? ` / ${n} Night${n === '1' ? '' : 's'}` : ''}` : '');
  const [name, setName] = useState<string>(draft.name ?? pkg?.name ?? '');
  const [objectKey, setObjectKey] = useState<string>(draft.objectKey ?? pkg?.itinerary_pdf_object_key ?? '');
  const [fileName, setFileName] = useState<string>(draft.fileName ?? pkg?.itinerary_pdf_file_name ?? '');
  // Optional extra itinerary documents (e.g. different day/night options) -- all are sent to
  // the customer, one after the other, so each needs its own Meta template approval. Each click
  // of "+ Add Itinerary" opens another empty upload box -- no limit on how many are open at once.
  interface PendingSlot { key: string; days: string; nights: string }
  const [pendingSlots, setPendingSlots] = useState<PendingSlot[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<string>('');
  const [slotProgress, setSlotProgress] = useState<{ loaded: number; total: number } | null>(null);
  // Before the package itself is first saved there's no id to attach documents to yet -- these
  // queue locally (already uploaded to storage, same as the primary document) and get registered
  // right after the package is created, so "Add another" works from the very first screen.
  interface DraftDoc { key: string; objectKey: string; fileName: string; days: string; nights: string }
  const [draftDocs, setDraftDocs] = useState<DraftDoc[]>(draft.draftDocs ?? []);
  // The download line comes first, right after the "Dear Mr. Ramesh," greeting -- customers were
  // mistaking the attached PDF for decoration and never opening it, since it used to be buried
  // at the bottom of the message.
  const DEFAULT_TEMPLATE = 'Your {duration}itinerary is attached above 👆\n\nDreaming of {destination} but worried about planning, hotels and cost?\n\n✨ We have done it for you — a ready {destination} itinerary with handpicked stays, sightseeing and transfers, all within your budget.';
  // Compact form for the message text -- "4D/5N" -- kept in sync with the Days/Nights
  // selected for the primary document, via the {duration} placeholder below.
  // Trailing space only when a real duration exists, so "Download your {duration}itinerary
  // above" reads cleanly either way -- "your 5 Days / 6 Nights itinerary" or plain "your itinerary".
  const shortDuration = (d: string, n: string) => (d ? `${durationLabel(d, n)} ` : '');
  // Collapses repeated spaces/tabs only -- a real \n the person typed inside a paragraph must
  // stay a real line break in the preview, not get silently flattened into one long line.
  const splitMessage = (text: string): [string, string] => {
    const clean = text.replace(/\r/g, '').trim();
    const parts = clean.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join('\n\n')];
    const one = (parts[0] || clean).replace(/[ \t]+/g, ' ');
    const match = one.match(/^(.+?[?!.])\s+(.+)$/s);
    return match ? [match[1], match[2]] : [one, 'Tap a button below to reach our expert.'];
  };
  // Mirrors the backend's splitItineraryMessage3 -- what's actually delivered keeps the hook and
  // offer as two separate lines instead of joining them, so the preview should match that.
  const splitMessage3 = (text: string): [string, string, string] => {
    const clean = text.replace(/\r/g, '').trim();
    const parts = clean.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
    if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join('\n\n')];
    if (parts.length === 2) return [parts[0], parts[1], 'Tap a button below to reach our expert.'];
    const one = (parts[0] || clean).replace(/[ \t]+/g, ' ');
    const first = one.match(/^(.+?[?!.])\s+(.+)$/s);
    if (!first) return [one, 'Tap a button below to reach our expert.', ''];
    const second = first[2].match(/^(.+?[?!.])\s+(.+)$/s);
    if (second) return [first[1], second[1], second[2]];
    return [first[1], first[2], 'Tap a button below to reach our expert.'];
  };
  const fillTemplate = (template: string, place: string, durationText?: string) => template.replace(/\{destination\}/g, place || 'your destination').replace(/\{duration\}/g, durationText || '');
  const introFor = (place: string) => fillTemplate(DEFAULT_TEMPLATE, place);
  const [message, setMessage] = useState<string>(draft.message ?? (pkg?.description || introFor(pkg?.destinations?.[0] ?? '')));
  const [messageEdited, setMessageEdited] = useState<boolean>(draft.messageEdited ?? !!pkg?.description);
  const [contactNumber, setContactNumber] = useState<string>(draft.contactNumber ?? pkg?.contact_number ?? '');
  const [testNumber, setTestNumber] = useState('');
  const [selectedTestNumbers, setSelectedTestNumbers] = useState<string[]>([]);
  const [tested, setTested] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [metaDetails, setMetaDetails] = useState<TourPackage['meta_details']>(null);
  const [docMetaDetails, setDocMetaDetails] = useState<Record<string, any>>({});
  const [submittingAll, setSubmittingAll] = useState(false);
  const [templateStatus, setTemplateStatus] = useState(pkg?.whatsapp_template_status || 'NOT_SUBMITTED');
  // `pkg` is a prop, not read directly from the query here -- a background refetch (e.g. the
  // instant template_status_update socket event invalidating ['packages']) lands as a new `pkg`
  // on a re-render, but without this, the *local* templateStatus state captured at mount would
  // just sit there stale until the next manual check, defeating the whole point of pushing an
  // instant update in the first place.
  useEffect(() => {
    if (pkg?.whatsapp_template_status) setTemplateStatus(pkg.whatsapp_template_status);
  }, [pkg?.whatsapp_template_status]);
  const [templateReason, setTemplateReason] = useState(pkg?.whatsapp_template_rejection_reason || '');
  useEffect(() => { setTemplateReason(pkg?.whatsapp_template_rejection_reason || ''); }, [pkg?.whatsapp_template_rejection_reason]);
  const [active, setActive] = useState(pkg?.is_active ?? false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [pageImg, setPageImg] = useState('');
  // Page-1 thumbnails for the additional itinerary documents, keyed by object key -- generated
  // lazily below (the primary document's own thumbnail already renders via pageImg/upload()).
  const [docThumbs, setDocThumbs] = useState<Record<string, string>>({});
  const [pages, setPages] = useState(0);
  const [fileSize, setFileSize] = useState<number>(draft.fileSize ?? 0);
  const [buttonLabel, setButtonLabel] = useState<string>(draft.buttonLabel ?? pkg?.contact_button_text ?? 'Call our experts');
  const [buttons, setButtons] = useState<PackageButton[]>(draft.buttons ?? pkg?.buttons ?? [{ type: 'call', text: pkg?.contact_button_text || 'Call our experts', phone: pkg?.contact_number || '' }, { type: 'chat', text: 'Chat with us' }, { type: 'duration', text: 'Explore More Itineraries' }]);
  const [buttonsInfoOpen, setButtonsInfoOpen] = useState(false);
  // Same order the template is submitted with: Explore first (visible without scrolling), then Call, then Chat/link.
  const nonCallButtons = buttons.filter((b) => b.type === 'url' || b.type === 'chat' || b.type === 'duration').slice(0, 2);
  const orderedButtons: PackageButton[] = [...nonCallButtons.filter((b) => b.type === 'duration'), ...buttons.filter((b) => b.type === 'call').slice(0, 1), ...nonCallButtons.filter((b) => b.type !== 'duration')];
  const buttonCounts = { call: buttons.filter((b) => b.type === 'call').length, url: buttons.filter((b) => b.type === 'url').length, chat: buttons.filter((b) => b.type === 'chat').length, duration: buttons.filter((b) => b.type === 'duration').length };
  const nonCallButtonCount = buttonCounts.url + buttonCounts.chat + buttonCounts.duration;
  const updateButton = (index: number, patch: Partial<PackageButton>) => setButtons((list) => list.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const [contactName, setContactName] = useState<string>(draft.contactName ?? pkg?.contact_name ?? '');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewDark, setPreviewDark] = useState(false);
  const [phoneZoom, setPhoneZoom] = useState(100);
  const [autoFit, setAutoFit] = useState(true);
  const [fitZoom, setFitZoom] = useState(100);
  const phoneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
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
    // The moment a second duration-tagged itinerary exists, the "Explore More Itineraries"
    // button belongs on the message -- added automatically here rather than needing a manual
    // "+ Duration options" click, so Buttons-under-the-message and the preview/simulation both
    // reflect it the instant it becomes relevant -- but only once the file is actually
    // uploaded, not just as soon as Days/Nights are typed (a still-pending slot has nothing
    // real to send yet, so it must not count).
    const taggedCount = (days && nights && objectKey ? 1 : 0)
      + (pkg ? documents : draftDocs).filter((d: any) => (pkg ? d.duration_nights : d.nights) && (pkg ? d.duration_days : d.days) && (pkg ? d.object_key : d.objectKey)).length;
    if (taggedCount >= 2 && !buttons.some((b) => b.type === 'duration')) {
      setButtons((list) => [...list, { type: 'duration', text: 'Explore More Itineraries' }]);
    } else if (taggedCount < 2 && buttons.some((b) => b.type === 'duration')) {
      // Mirrors the add: if it drops back below 2 (e.g. the 2nd itinerary got removed), the
      // button has nothing real to offer and shouldn't linger -- removed automatically too.
      setButtons((list) => list.filter((b) => b.type !== 'duration'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, nights, documents, draftDocs, pendingSlots, pkg]);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, campaignName, destination, days, nights, name, objectKey, fileName, draftDocs, message, messageEdited, contactNumber, contactName, buttonLabel, buttons, template, fileSize }));
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, campaignName, destination, days, nights, name, objectKey, fileName, draftDocs, message, messageEdited, contactNumber, contactName, buttonLabel, buttons, template, fileSize]);
  useEffect(() => {
    if (messageEdited) return;
    // A brand-new itinerary always starts from the real default wording -- picking an old saved
    // message preset here instead (whatever happened to be saved first) meant new itineraries
    // silently lost the "Download your itinerary above" line if that preset predated it. Presets
    // are still available, just only when explicitly picked from "Message templates" above.
    const base = template || DEFAULT_TEMPLATE;
    setMessage(fillTemplate(base, destination, shortDuration(days, nights)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, days, nights, template, presets.length, messageEdited]);
  useEffect(() => {
    if (!objectKey) return setPreviewUrl('');
    getPackageDocumentPreview(objectKey).then((value) => { if (value.url) setPreviewUrl((cur) => (cur.startsWith('blob:') ? cur : value.url || '')); if (value.url && /\.pdf$/i.test(fileName)) fetchPackageDocumentBytes(objectKey).then((bytes) => renderPdfFirstPage(bytes)).then((r) => { setPageImg(r.img); setPages(r.pages); }).catch(() => undefined); }).catch(() => setPreviewUrl(''));
  }, [objectKey]);
  // Same page-1 thumbnail the primary document gets, for every additional itinerary document --
  // generated once per document and cached, so the preview shows the real PDF cover instead of a
  // generic file icon.
  useEffect(() => {
    const extraDocs: any[] = pkg ? documents : draftDocs;
    for (const doc of extraDocs) {
      const key = doc.object_key ?? doc.objectKey;
      const name = doc.file_name ?? doc.fileName ?? '';
      if (!key || docThumbs[key]) continue;
      if (/\.pdf$/i.test(name)) {
        fetchPackageDocumentBytes(key).then((bytes) => renderPdfFirstPage(bytes)).then((r) => setDocThumbs((m) => ({ ...m, [key]: r.img }))).catch(() => undefined);
      } else if (/\.(png|jpe?g|webp)$/i.test(name)) {
        // An uploaded itinerary can be a plain image instead of a PDF -- same preview-URL call
        // the primary document uses, just reused per additional document.
        getPackageDocumentPreview(key).then((v) => { if (v.url) setDocThumbs((m) => ({ ...m, [key]: v.url })); }).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg ? documents : draftDocs]);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setUploading(true); setProgress({ loaded: 0, total: file.size }); setPageImg(''); setPages(0); setFileSize(file.size);
    if (/\.pdf$/i.test(file.name)) renderPdfFirstPage(file).then((r) => { setPageImg(r.img); setPages(r.pages); }).catch(() => undefined);
    // Images preview straight from the chosen file -- instant, no round trip to storage.
    const localImage = /\.(jpe?g|png|webp)$/i.test(file.name) ? URL.createObjectURL(file) : '';
    try { const result = await uploadPackageDocument(file, 'packages/itineraries', (loaded, total) => setProgress({ loaded, total })); setObjectKey(result.objectKey); setFileName(file.name); setPreviewUrl(localImage || result.url); toast('Itinerary uploaded','success'); }
    catch (error:any) { toast(error.message || 'Upload failed','error'); }
    finally { setUploading(false); setProgress(null); }
  }

  // The card's X takes away only the uploaded file: the itinerary stays as an open slot with its
  // Days/Nights still filled in, ready for another file ("Cancel" on that slot drops it entirely).
  function removeDocumentFile(doc: any) {
    const slot = { key: `${Date.now()}-${Math.random()}`, days: String(pkg ? (doc.duration_days ?? '') : (doc.days ?? '')), nights: String(pkg ? (doc.duration_nights ?? '') : (doc.nights ?? '')) };
    if (pkg) deleteDocument.mutate(doc.id); else setDraftDocs((list) => list.filter((x) => x.key !== doc.key));
    setPendingSlots((list) => [...list, slot]);
  }

  // Swap the file of an itinerary that's already added (wrong file picked) WITHOUT losing its
  // Days/Nights. Saved documents are re-registered with the same duration, then the old one goes.
  const [replacingDoc, setReplacingDoc] = useState<string | null>(null);
  async function replaceDocumentFile(doc: any, file: File) {
    const docKey = String(doc.id ?? doc.key);
    setReplacingDoc(docKey);
    try {
      const result = await uploadPackageDocument(file, 'packages/itineraries');
      if (/\.(jpe?g|png|webp)$/i.test(file.name)) setDocThumbs((m) => ({ ...m, [result.objectKey]: URL.createObjectURL(file) }));
      else if (/\.pdf$/i.test(file.name)) renderPdfFirstPage(file).then((r) => setDocThumbs((m) => ({ ...m, [result.objectKey]: r.img }))).catch(() => undefined);
      if (pkg) {
        await addDocument.mutateAsync({ durationDays: doc.duration_days ?? undefined, durationNights: doc.duration_nights ?? undefined, objectKey: result.objectKey, fileName: file.name });
        await deleteDocument.mutateAsync(doc.id);
      } else {
        setDraftDocs((list) => list.map((x) => (x.key === doc.key ? { ...x, objectKey: result.objectKey, fileName: file.name } : x)));
      }
      toast('File replaced — Days and Nights kept', 'success');
    } catch (error: any) { toast(error.message || 'Could not replace the file', 'error'); }
    finally { setReplacingDoc(null); }
  }

  // Uploads one pending slot's file and registers it as a document, then removes that slot --
  // any other slots still open (or already-registered documents) are untouched.
  async function uploadAdditionalDocument(event: React.ChangeEvent<HTMLInputElement>, slot: PendingSlot) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    // Nights is mandatory -- it's what the "Explore More Itineraries" duration list is built
    // from, so a document with no nights set can never be offered to a customer. Block the
    // upload rather than silently saving an unusable document.
    if (slot.nights === '') { toast('Enter the number of nights before uploading -- the duration list needs it', 'error'); return; }
    setUploadingSlot(slot.key); setSlotProgress({ loaded: 0, total: file.size });
    try {
      const result = await uploadPackageDocument(file, 'packages/itineraries', (loaded, total) => setSlotProgress({ loaded, total }));
      // Thumbnail from the chosen file itself (image, or PDF page 1) so it shows immediately.
      if (/\.(jpe?g|png|webp)$/i.test(file.name)) setDocThumbs((m) => ({ ...m, [result.objectKey]: URL.createObjectURL(file) }));
      else if (/\.pdf$/i.test(file.name)) renderPdfFirstPage(file).then((r) => setDocThumbs((m) => ({ ...m, [result.objectKey]: r.img }))).catch(() => undefined);
      if (pkg) {
        await addDocument.mutateAsync({ durationDays: slot.days ? Number(slot.days) : undefined, durationNights: slot.nights !== '' ? Number(slot.nights) : undefined, objectKey: result.objectKey, fileName: file.name });
      } else {
        setDraftDocs((list) => [...list, { key: `${Date.now()}`, objectKey: result.objectKey, fileName: file.name, days: slot.days, nights: slot.nights }]);
      }
      setPendingSlots((list) => list.filter((s) => s.key !== slot.key));
      toast('Itinerary document added', 'success');
    } catch (error:any) { toast(error.message || 'Upload failed','error'); }
    finally { setUploadingSlot(''); setSlotProgress(null); }
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
      if (showToast) toast(result.whatsapp_template_status === 'APPROVED' ? 'Template approved by Meta' : 'Status refreshed', 'success');
    }).catch((e: any) => { if (showToast) toast(e.message || 'Status refresh failed', 'error'); });
  }
  function checkDocApproval(docId: string, showToast = false) {
    return syncDocTemplate.mutateAsync(docId).then((result: any) => {
      setDocMetaDetails((m) => ({ ...m, [docId]: result.meta_details ?? null }));
      if (showToast) toast('Status refreshed', 'success');
    }).catch((e: any) => { if (showToast) toast(e.message || 'Status refresh failed', 'error'); });
  }
  // One click submits the primary template and every additional document that still needs
  // submitting (NOT_SUBMITTED or REJECTED), one after another -- instead of hunting down a
  // separate "Submit" button per itinerary.
  async function submitAllTemplates() {
    if (!pkg) return;
    setSubmittingAll(true);
    // Collects every failure instead of swallowing them -- a swallowed per-document error used
    // to let this end on "Submitted to Meta for review" even when nothing actually went through,
    // which is exactly what made this button look broken with no clue why.
    const failures: string[] = [];
    try {
      if (templateStatus === 'NOT_SUBMITTED' || templateStatus === 'REJECTED') {
        try {
          const result = await submitTemplate.mutateAsync(pkg.id);
          setTemplateStatus(result.whatsapp_template_status);
          setTemplateReason(result.whatsapp_template_rejection_reason || '');
          setCheckedAt(new Date());
        } catch (e: any) { failures.push(`Primary itinerary: ${e.message || 'failed'}`); }
      }
      for (const doc of documents) {
        const st = doc.whatsapp_template_status || 'NOT_SUBMITTED';
        if (st !== 'NOT_SUBMITTED' && st !== 'REJECTED') continue;
        try { await submitDocTemplate.mutateAsync(doc.id); }
        catch (e: any) { failures.push(`${durationLabel(String(doc.duration_days??''),String(doc.duration_nights??'')) || doc.file_name || 'Document'}: ${e.message || 'failed'}`); }
      }
      await checkApproval();
      if (failures.length) toast(failures.join(' · '), 'error');
      else toast('Submitted to Meta for review', 'success');
    } catch (e: any) { toast(e.message || 'Template submission failed', 'error'); }
    finally { setSubmittingAll(false); }
  }
  // Silent -- runs automatically (stage open + every 20s while pending), never a manual button,
  // so there's nothing here for the person to notice besides the status changing on screen.
  async function checkAllTemplates() {
    await checkApproval(false);
    for (const doc of documents) await checkDocApproval(doc.id, false).catch(() => undefined);
  }
  // Load Meta's details once when the approval stage opens for an already-submitted template
  // (primary and every additional document that doesn't have its details cached yet).
  useEffect(() => {
    if (step !== 3 || !pkg) return;
    if (templateStatus !== 'NOT_SUBMITTED' && !metaDetails) checkApproval();
    for (const doc of documents) {
      if (doc.whatsapp_template_status && doc.whatsapp_template_status !== 'NOT_SUBMITTED' && !docMetaDetails[doc.id]) checkDocApproval(doc.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pkg?.id, documents.length]);
  // No manual refresh needed -- while anything is still pending review, re-check on entering the
  // stage and every 20 seconds, for the primary template and every additional document.
  useEffect(() => {
    const anyPending = templateStatus === 'PENDING' || documents.some((d) => (d.whatsapp_template_status || 'NOT_SUBMITTED') === 'PENDING');
    if (step !== 3 || !pkg || !anyPending) return;
    checkAllTemplates();
    const timer = setInterval(() => { checkAllTemplates(); }, 20000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pkg?.id, templateStatus, documents.map((d) => d.whatsapp_template_status).join(',')]);

  const mobileDigits = (value: string) => waNumber(value);
  const normalizePhone = (value: string) => { const digits = value.replace(/\D/g, ''); return digits.length === 10 ? `91${digits}` : digits; };
  const testList = automation?.test_numbers || [];
  const testActions = {
    add: (value: string) => { const n = normalizePhone(value); if (n.length >= 10 && !testList.includes(n)) updateTestNumbers.mutate([...testList, n]); },
    update: (id: string, value: string) => { const n = normalizePhone(value); if (n.length >= 10) updateTestNumbers.mutate(testList.map((x) => (x === id ? n : x))); },
    remove: (id: string) => updateTestNumbers.mutate(testList.filter((x) => x !== id)),
  };
  function toggleTestNumber(n: string) {
    setSelectedTestNumbers((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : cur.length >= MAX_TEST_NUMBERS ? cur : [...cur, n]));
  }
  function addAndSelectTestNumber(n: string) {
    if (!testList.includes(n)) updateTestNumbers.mutate([...testList, n]);
    setSelectedTestNumbers((cur) => (cur.includes(n) || cur.length >= MAX_TEST_NUMBERS ? cur : [...cur, n]));
  }
  function updateTestNumber(oldN: string, newRaw: string) {
    const n = normalizePhone(newRaw);
    if (n.length < 10) return;
    updateTestNumbers.mutate(testList.map((x) => (x === oldN ? n : x)));
    setSelectedTestNumbers((cur) => cur.map((x) => (x === oldN ? n : x)));
  }
  function removeTestNumber(n: string) {
    updateTestNumbers.mutate(testList.filter((x) => x !== n));
    setSelectedTestNumbers((cur) => cur.filter((x) => x !== n));
  }
  async function sendTestMessage() {
    if (!pkg) return;
    const targets = selectedTestNumbers.length ? selectedTestNumbers : (normalizePhone(testNumber).length >= 11 ? [normalizePhone(testNumber)] : []);
    if (!targets.length) return toast('Pick or enter at least one test number', 'error');
    const newOnes = targets.filter((n) => !testList.includes(n));
    try {
      if (newOnes.length) await updateTestNumbers.mutateAsync([...testList, ...newOnes]);
      let failed = 0;
      for (const n of targets) {
        try { await sendTest.mutateAsync({ packageId: pkg.id, to: n }); } catch { failed++; }
      }
      setTested(true);
      if (failed) toast(`Sent to ${targets.length - failed} of ${targets.length} numbers — ${failed} failed`, failed === targets.length ? 'error' : 'success');
      else toast(`Test message accepted by WhatsApp (${targets.length} number${targets.length > 1 ? 's' : ''})`, 'success');
    } catch (e: any) { toast(e.message || 'Test failed', 'error'); }
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
      toast(`Accepted by Meta: ${r.sent}${r.skippedTestMode ? `, ${r.skippedTestMode} skipped (test mode)` : ''}${r.failed ? `, ${r.failed} failed` : ''}${r.noPhone ? `, ${r.noPhone} without a valid number` : ''} — actual delivery to the customer is confirmed separately, not guaranteed by this`, r.failed ? 'error' : 'success');
    } catch (e: any) { toast(e.message || 'Could not send', 'error'); }
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

  // Take the user straight to whatever needs fixing: scroll it to the middle of the screen,
  // outline it in red for a moment, and put the cursor in its first field.
  function jumpTo(selector: string) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-red-500', 'ring-offset-2');
    setTimeout(() => el.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2'), 2500);
    const field = el.querySelector('input, textarea, button') as HTMLElement | null;
    setTimeout(() => field?.focus({ preventScroll: true }), 400);
  }

  async function saveDraft() {
    if (!destination.trim()) return toast('Destination could not be detected. Enter it before continuing.','error');
    if (!objectKey) { jumpTo('[data-field="itinerary-1"]'); return toast('Upload an itinerary document','error'); }
    if (nights === '') { jumpTo('[data-field="itinerary-1"]'); return toast('Choose Days and Nights for Itinerary 1','error'); }
    const buttonProblem = (() => {
      for (const [i, b] of buttons.entries()) {
        if (!b.text.trim()) return { i, msg: 'Every button needs some text' };
        if (b.type === 'call' && !mobileDigits(b.phone || '')) return { i, msg: 'Type a valid phone number on the Call button, e.g. 06 12 34 56 78 or +33 6 12 34 56 78' };
        if (b.type === 'chat' && !mobileDigits(b.phone || '')) return { i, msg: 'Type a valid WhatsApp number on the Chat button, e.g. 06 12 34 56 78 or +33 6 12 34 56 78' };
        if (b.type === 'url' && !/^https?:\/\/\S+\.\S+/.test((b.url || '').trim())) return { i, msg: 'Website buttons need a full link starting with https://' };
      }
      return null;
    })();
    if (buttonProblem) { jumpTo(`[data-btn-row="${buttonProblem.i}"]`); return toast(buttonProblem.msg, 'error'); }
    try {
      if (pkg) {
        // Changing the uploaded file (or the call number/buttons) means whatever Meta already
        // approved no longer matches what would actually be sent -- the backend detects this
        // and resets the status to NOT_SUBMITTED itself. Surface that clearly here instead of
        // silently keeping the old "In review"/"Approved" badge with no sign anything changed.
        const hadApprovalBefore = templateStatus !== 'NOT_SUBMITTED';
        const saved: any = await updatePackage.mutateAsync(payload(false));
        clearDraft();
        const newStatus = saved?.whatsapp_template_status || 'NOT_SUBMITTED';
        setTemplateStatus(newStatus);
        setTemplateReason(saved?.whatsapp_template_rejection_reason || '');
        setMetaDetails(null); setCheckedAt(null); setTested(false); setStep(3);
        if (hadApprovalBefore && newStatus === 'NOT_SUBMITTED') {
          toast('You changed the itinerary (file, number, or buttons) -- the previous Meta approval no longer applies. Please submit it again.', 'error');
        } else {
          toast('Saved. Now submit the template to Meta for approval.', 'success');
        }
      }
      else {
        const created = await createPackage.mutateAsync(payload(false));
        // Any additional documents added before the package existed were only uploaded to
        // storage, not registered yet -- register them now that a real package id exists.
        for (const doc of draftDocs) {
          await api.post(`/packages/${created.id}/documents`, { durationDays: doc.days ? Number(doc.days) : undefined, durationNights: doc.nights !== '' ? Number(doc.nights) : undefined, objectKey: doc.objectKey, fileName: doc.fileName }).catch(() => undefined);
        }
        clearDraft(); toast('Draft saved. Continue with the test.','success'); router.replace(`/packages/${created.id}?stage=test`);
      }
    } catch(error:any) { toast(error.message || 'Could not save draft','error'); }
  }

  async function activate() {
    if (!pkg) return;
    try {
      await updatePackage.mutateAsync(payload(active)); clearDraft();
      toast(active ? 'Itinerary activated for automatic delivery' : 'Itinerary saved inactive','success');
      if (active && templateStatus === 'APPROVED') {
        const status = await fetchPackageDelivery(pkg.id).catch(() => null);
        if (status && status.pending > 0 && window.confirm(`${status.pending} enquiries for this campaign have not received the itinerary yet. Send it to them now?${status.liveMode ? '' : '\n\nTest mode is ON: only approved test numbers will really receive it; the rest are skipped.'}`)) {
          const r = await sendPending.mutateAsync(pkg.id);
          toast(`Accepted by Meta: ${r.sent}${r.skippedTestMode ? `, ${r.skippedTestMode} skipped (test mode)` : ''}${r.failed ? `, ${r.failed} failed` : ''} — check back on this page in a few minutes for real delivery status`, r.failed ? 'error' : 'success');
        }
      }
      router.push('/packages');
    }
    catch(error:any) { toast(error.message || 'Could not save itinerary','error'); }
  }
  const saving = createPackage.isPending || updatePackage.isPending;
  const filteredCampaigns = (campaigns?.data || []).filter((c) => c.name.toLowerCase().includes(campaignName.trim().toLowerCase()));
  // A typed name that doesn't exactly match a real Meta campaign can never actually receive
  // messages -- nothing routes to it. Editing an already-saved package is grandfathered (its
  // campaign may since have been renamed/archived in Meta, which isn't a reason to block editing).
  // A test itinerary may use any name: it matches no real Meta campaign, so it can never go to a
  // customer automatically -- it only goes to the test numbers in stage 4.
  const [testItinerary, setTestItinerary] = useState(false);
  const campaignMatchesMeta = !!campaignName.trim() && (campaigns?.data || []).some((c) => c.name === campaignName.trim());
  const campaignIsReal = !!pkg || campaignMatchesMeta || (testItinerary && !!campaignName.trim());
  // The exact set of duration options the Utility button will actually offer on WhatsApp --
  // read-only here (not editable, it's wired straight from the itinerary documents below, not
  // typed), so what's configured in Buttons-under-the-message always matches what's really
  // uploaded, with no separate place that could drift out of sync.
  // Only a document that's actually uploaded counts as a real option -- Days/Nights typed in
  // but no file chosen yet (a still-open "+ Add Itinerary" slot) isn't a real itinerary a
  // customer could be sent, so it must not appear as a selectable duration anywhere yet.
  // The primary itinerary (the one sent up front) is deliberately left out here -- listing it
  // back as a choice on "Explore More Itineraries" just gets "that's the same one above 👆" as
  // the reply, which reads as the bot not having listened. Only the other uploaded itineraries
  // are genuinely worth offering (matches sendDurationOptionsList on the backend).
  const availableDurationOptions = [
    ...(pkg ? documents : draftDocs).filter((d: any) => (pkg ? d.duration_days : d.days) && (pkg ? d.duration_nights : d.nights) && (pkg ? d.object_key : d.objectKey)).map((d: any) => ({ key: String(d.id ?? d.key), days: String(pkg ? d.duration_days : d.days), nights: String(pkg ? d.duration_nights : d.nights) })),
  ];
  const labeledDurationOptions = labelDurationOptions(availableDurationOptions);
  // For the duplicate warning shown next to each upload slot -- compares Days/Nights across
  // *every* itinerary, uploaded or still pending, since the point is to warn before an upload
  // happens, not only after.
  const allDurationEntries = [
    ...(days && nights ? [{ key: 'primary', days, nights }] : []),
    ...(pkg ? documents : draftDocs).filter((d: any) => (pkg ? d.duration_days : d.days) && (pkg ? d.duration_nights : d.nights)).map((d: any) => ({ key: String(d.id ?? d.key), days: String(pkg ? d.duration_days : d.days), nights: String(pkg ? d.duration_nights : d.nights) })),
    ...pendingSlots.filter((s) => s.days && s.nights).map((s) => ({ key: s.key, days: s.days, nights: s.nights })),
  ];
  const labeledDurationEntries = labelDurationOptions(allDurationEntries);
  const duplicateWarningFor = (key: string) => labeledDurationEntries.find((e) => e.key === key && e.isDuplicate);
  // Which Meta campaigns already have an itinerary -- shown as a tag right in the search
  // results, so a duplicate is obvious before picking it, not only after.
  const campaignsWithItinerary = new Set((allPackages?.data ?? []).filter((p: any) => !p.is_deleted).map((p: any) => p.campaign_name));
  // Picking a campaign that already has an itinerary used to silently create a second, separate
  // one for the same campaign (easy to do by accident, e.g. picking the wrong similarly-named
  // campaign) -- surfaced here so the person can add another document to the existing itinerary
  // instead of creating a duplicate.
  const existingForCampaign = !pkg && campaignName.trim()
    ? (allPackages?.data ?? []).filter((p: any) => !p.is_deleted && p.campaign_name === campaignName.trim())
    : [];

  const PhonePreview = () => {
    const shownName = profile?.name || 'Errances Voyages';
    // Every tagged duration (primary + any additional document that has both days and nights
    // set) -- exactly the same candidate set the real webhook builds its tappable list from
    // (see getDurationCandidates on the backend), so clicking through here is a true simulation
    // of what a customer sees, not just a description of it.
    const [simMessages, setSimMessages] = useState<({ kind: 'askMore' } | { kind: 'doc'; fileName: string; days: string; nights: string; isPrimary: boolean; objectKey: string } | { kind: 'onlyOne' } | { kind: 'custom' } | { kind: 'allSent' } | { kind: 'calledBack' })[]>([]);
    // Reopening the list (tapped "Yes, show me more") must show which durations were already
    // picked this chat -- disabled with a filled radio dot instead of just letting a customer
    // tap the same one again and get the "you already have this" reply with no warning first.
    const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
    // WhatsApp's real interactive-list message shows the body text plus one button (e.g.
    // "Choose"); tapping it opens a native bottom sheet listing the rows -- the options are
    // never shown as inline stacked buttons already expanded in the chat. This tracks which
    // simulated list message (by index) currently has its sheet open.
    const [openListFor, setOpenListFor] = useState<number | null>(null);
    const extraForSim = pkg ? documents : draftDocs;
    // Only a document actually uploaded counts here -- a pending "+ Add Itinerary" slot with
    // Days/Nights typed but no file chosen yet has nothing real to send, so it must not show up
    // as a selectable option in the simulation either (matches availableDurationOptions above).
    // The primary itinerary itself is deliberately excluded -- listing it back as a choice just
    // gets "that's the same one above 👆" as the reply (matches sendDurationOptionsList).
    const durationCandidatesRaw: { id: string; fileName: string; days: string; nights: string; isPrimary: boolean; objectKey: string }[] = [
      ...extraForSim
        .filter((d: any) => (pkg ? d.object_key : d.objectKey))
        .map((d: any) => ({ id: String(d.id ?? d.key), fileName: d.file_name ?? d.fileName ?? 'Itinerary.pdf', days: String(pkg ? d.duration_days ?? '' : d.days ?? ''), nights: String(pkg ? d.duration_nights ?? '' : d.nights ?? ''), isPrimary: false, objectKey: String(pkg ? d.object_key : d.objectKey) }))
        .filter((d) => d.days && d.nights),
    ];
    const durationCandidates = labelDurationOptions(durationCandidatesRaw);
    // Only one message is ever actually sent up front -- the primary template. Additional
    // itinerary documents are never sent as their own message; they only go out later, on
    // demand, when a customer taps "Explore More Itineraries" and picks a duration (see the
    // webhook's sendDurationCandidate). The preview used to show one chat bubble per uploaded
    // document, which looked exactly like several templates going out together -- that never
    // happens, so the preview must only ever show this one card, however many documents exist.
    const cards = [{ isExtra: false, fileName, days, nights, thumb: '' }];
    const T = previewDark
      ? { frame: 'bg-[#0b141a]', head: 'bg-[#202c33]', pill: 'bg-[#182229] text-slate-400', bubble: 'bg-[#005c4b] text-white', card: 'bg-[#025144]', cardEmpty: 'bg-[#0b3d35]', ghost: 'text-white/40', dash: 'border-white/20 text-white/60', sub: 'text-white/60', body: 'text-white/85', line: 'border-white/10 hover:bg-white/5', btn: 'text-[#53bdeb]', foot: 'bg-[#202c33]', input: 'bg-[#2a3942] text-slate-400' }
      : { frame: 'bg-[#efeae2]', head: 'bg-[#075e54]', pill: 'bg-white/80 text-slate-500', bubble: 'bg-[#d9fdd3] text-slate-800', card: 'bg-white/70', cardEmpty: 'bg-slate-100', ghost: 'text-slate-400', dash: 'border-slate-400/40 text-slate-500', sub: 'text-slate-500', body: 'text-slate-700', line: 'border-black/10 hover:bg-black/5', btn: 'text-[#0a7cff]', foot: 'bg-[#f0f2f5]', input: 'bg-white text-slate-400' };
    const btn = `flex w-full items-center justify-center gap-2 border-t py-2.5 text-[13px] font-semibold ${T.line} ${T.btn}`;
    const scrollToCard = (i: number) => cardRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // A real click-through simulation of the actual webhook flow (sendDurationOptionsList /
    // sendDurationCandidate on the backend) -- tapping "Explore More Itineraries" here does
    // exactly what tapping it on a real phone does: shows the tappable duration list; picking
    // one "sends" that document and removes it from the list entirely (matches the backend,
    // which excludes anything already in package_document_sends for this number), then asks
    // "Explore More Itineraries" / "Call our experts" so the customer can keep going or stop --
    // same as production, not just a description of it.
    const remainingCandidates = durationCandidates.filter((c) => !pickedIds.has(c.id));
    const openDurationSheet = () => {
      if (remainingCandidates.length < 1) {
        setSimMessages((m) => [...m, { kind: pickedIds.size > 0 ? 'allSent' : 'onlyOne' }]);
        return;
      }
      setOpenListFor(-1);
    };
    const simulateExplore = openDurationSheet;
    const simulatePick = (c: typeof durationCandidates[number]) => {
      setOpenListFor(null);
      setPickedIds((s) => new Set(s).add(c.id));
      setSimMessages((m) => [...m, { kind: 'doc', fileName: c.fileName, days: c.days, nights: c.nights, isPrimary: c.isPrimary, objectKey: c.objectKey }]);
      // Every pick -- including the primary ("already sent you above") one -- now asks "want
      // to explore more?" (matches sendDurationCandidate's askExploreMore on the backend).
      setSimMessages((m) => [...m, { kind: 'askMore' }]);
    };
    const simulateCallExperts = () => setSimMessages((m) => [...m, { kind: 'calledBack' }]);
    // The trailing "Need other days/nights?" row -- tapping it mirrors sendDurationOptionsList's
    // real reply (whatsapp-bot.service.ts) rather than sending a document. There's nothing to
    // simulate past that single acknowledgement, since what happens next (a human picking it up
    // on the Callback Requests list) isn't part of the chat itself.
    const simulatePickCustom = () => {
      setOpenListFor(null);
      setSimMessages((m) => [...m, { kind: 'custom' }]);
    };
    return <aside className="sticky top-2 self-start"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-navy">WhatsApp preview <span className="text-[11px] font-normal text-muted-foreground">· what the customer receives{cards.length > 1 ? ` (${cards.length} messages, one chat)` : ''}</span></p><div className="flex items-center gap-1.5"><div className="flex items-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-navy shadow-sm"><button type="button" onClick={() => { setPhoneZoom(Math.max(40, effZoom - 10)); setAutoFit(false); }} className="rounded-l-full px-2.5 py-1 hover:bg-slate-100" aria-label="Zoom out">−</button><button type="button" onClick={() => setAutoFit(true)} className="min-w-[3.5rem] px-1 py-1 text-center hover:bg-slate-100" title="Fit the whole phone on screen">{autoFit ? `Fit ${effZoom}%` : `${effZoom}%`}</button><button type="button" onClick={() => { setPhoneZoom(Math.min(160, effZoom + 10)); setAutoFit(false); }} className="rounded-r-full px-2.5 py-1 hover:bg-slate-100" aria-label="Zoom in">+</button></div><button type="button" onClick={() => setPreviewDark((v) => !v)} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-navy shadow-sm hover:border-gold">{previewDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}{previewDark ? 'Light' : 'Dark'}</button></div></div>
      {cards.length > 1 && <div className="mb-2 flex flex-wrap gap-1.5">{cards.map((c, i) => <button key={i} type="button" onClick={() => scrollToCard(i)} className="rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-navy hover:bg-gold/30">Itinerary {i + 1}{c.days ? ` · ${c.days}D/${c.nights || 0}N` : ''}</button>)}</div>}
      <div ref={phoneRef} style={{ zoom: effZoom / 100 }} className={`relative mx-auto w-full max-w-[24rem] overflow-hidden rounded-[2.3rem] border-[8px] border-slate-900 shadow-2xl ${T.frame}`}>
        <div className="flex h-7 items-center justify-center bg-slate-900"><span className="h-1.5 w-20 rounded-full bg-slate-700"/></div>
        <div className={`flex items-center gap-3 px-4 py-3 text-white ${T.head}`}>{profile?.pictureUrl ? <img src={profile.pictureUrl} alt={shownName} className="h-9 w-9 rounded-full object-cover"/> : <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-xs font-bold">{shownName.split(/\s+/).map((w: string)=>w[0]).slice(0,2).join('').toUpperCase()}</div>}<div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{shownName}</p><p className="text-[10px] text-white/70">Business Account</p></div><Video className="h-4 w-4"/><Phone className="h-4 w-4"/><MoreVertical className="h-4 w-4"/></div>
        <div className="p-3">
          <div className={`mx-auto mb-3 w-fit rounded-md px-2 py-1 text-[9px] ${T.pill}`}>TODAY</div>
          {cards.map((c, i) => {
            const isExtra = c.isExtra;
            const previewFileName = c.fileName;
            const isImageFile = /\.(jpe?g|png|webp)$/i.test(previewFileName);
            // Itinerary 1 uses its own preview; additional itineraries use their thumbnail (image itself, or PDF page 1).
            const imageSrc = isExtra ? c.thumb : previewUrl;
            const isPdfFile = /\.pdf$/i.test(previewFileName);
            const meta = isExtra ? (isPdfFile ? 'PDF' : 'Document') : [pages ? `${pages} page${pages > 1 ? 's' : ''}` : '', isPdfFile ? 'PDF' : isImageFile ? 'Image' : 'Document', fileSize ? `${(fileSize / 1048576).toFixed(fileSize > 10485760 ? 0 : 1)} MB` : ''].filter(Boolean).join(' · ');
            return <div key={i} ref={(el) => { cardRefs.current[i] = el; }} className={i > 0 ? 'mt-3' : ''}>
              {cards.length > 1 && <p className="mb-1 text-center text-[10px] font-bold uppercase tracking-wide text-navy/60">Itinerary {i + 1}{c.days ? ` · ${c.days}D/${c.nights || 0}N` : ''}</p>}
              <div className={`ml-auto max-w-[94%] overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                <div className="p-1">{previewFileName ? <div className={`overflow-hidden rounded-md ${T.card}`}>{isImageFile && imageSrc ? <img src={imageSrc} alt="Itinerary preview" className="max-h-48 w-full object-cover object-top"/> : isPdfFile && !isExtra && pageImg ? <img src={pageImg} alt="PDF page 1" className="max-h-60 w-full object-cover object-top"/> : isPdfFile && isExtra && c.thumb ? <img src={c.thumb} alt="PDF page 1" className="max-h-60 w-full object-cover object-top"/> : isPdfFile && isExtra ? <div className={`grid h-28 animate-pulse place-items-center ${T.cardEmpty}`}><RefreshCw className={`h-8 w-8 animate-spin ${T.ghost}`}/></div> : <div className={`grid h-28 place-items-center ${T.cardEmpty}`}><FileText className={`h-10 w-10 ${T.ghost}`}/></div>}{!(isImageFile && imageSrc) && <div className="flex items-center gap-2.5 px-3 py-2.5"><span className="grid h-8 w-7 shrink-0 place-items-center rounded bg-red-500 text-[8px] font-bold text-white">{isPdfFile ? 'PDF' : 'DOC'}</span><div className="min-w-0"><p className="truncate text-[12px] font-semibold">{previewFileName}</p><p className={`text-[10px] ${T.sub}`}>{meta}</p></div></div>}</div> : <div className={`rounded-md border-2 border-dashed p-6 text-center text-xs ${T.dash}`}><Paperclip className="mx-auto mb-2 h-5 w-5"/>Document preview appears after upload.</div>}</div>
                <div className="px-3 pb-1 pt-2 text-[13.5px] leading-[1.35rem]">{isExtra ? <><p className="mb-2">Dear Mr. Ramesh,</p><p className="whitespace-pre-wrap">📥 Download your {c.days?`${durationLabel(c.days,c.nights)} `:''}itinerary above👆.</p><p className="mt-2 whitespace-pre-wrap">{splitMessage3(message)[1]}</p><p className="mt-2 whitespace-pre-wrap">{splitMessage3(message)[2]}</p></> : message.trim() ? <><p className="mb-2">Dear Mr. Ramesh,</p><p className="whitespace-pre-wrap">{splitMessage3(message)[0]}</p><p className="mt-2 whitespace-pre-wrap">{splitMessage3(message)[1]}</p><p className="mt-2 whitespace-pre-wrap">{splitMessage3(message)[2]}</p></> : <p>Your message appears here.</p>}<p className={`mt-2 text-[12.5px] ${T.body}`}>Your expert: <strong>{contactName.trim() || 'Consultant name'} · {contactNumber.trim() || 'number'}</strong> — tap a button below to get in touch.</p><p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:30 am <span className="text-sky-400">✓✓</span></p></div>
                {i === cards.length - 1 && <div className="mt-1">{orderedButtons.map((b, bi) => <button key={bi} type="button" onClick={() => b.type === 'call' ? toast(`Opens the customer's phone dialer to call ${(b.phone || contactNumber).trim() || 'this number'}`, 'success') : b.type === 'url' ? toast(`Opens ${b.url || 'your link'} in the browser`, 'success') : b.type === 'duration' ? simulateExplore() : toast(`Opens a WhatsApp chat with ${(b.phone || '').trim() || 'this number'} and the starting message ready`, 'success')} className={btn}>{b.type === 'call' ? <PhoneCall className="h-4 w-4"/> : b.type === 'url' ? <ExternalLink className="h-4 w-4"/> : b.type === 'duration' ? <List className="h-4 w-4"/> : <MessageCircle className="h-4 w-4"/>}{b.text.trim() || 'Button'}</button>)}</div>}
              </div>
            </div>;
          })}
          {simMessages.map((m, i) => (
            <div key={i} className="mt-3 ml-auto max-w-[94%]">
              {m.kind === 'onlyOne' ? (
                <div className={`overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                  <div className="px-3 py-2.5 text-[13.5px] leading-[1.35rem]">
                    <p className="whitespace-pre-wrap">We currently only have the one itinerary length for this trip -- that's the one above 👆</p>
                    <p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:31 am <span className="text-sky-400">✓✓</span></p>
                  </div>
                </div>
              ) : m.kind === 'custom' ? (
                <div className={`overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                  <div className="px-3 py-2.5 text-[13.5px] leading-[1.35rem]">
                    <p className="whitespace-pre-wrap">Sure! Just type the number of days and nights you have in mind, and our team will check it out for you. 🙏</p>
                    <p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:31 am <span className="text-sky-400">✓✓</span></p>
                  </div>
                </div>
              ) : m.kind === 'doc' ? (
                <div className={`overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                  {!m.isPrimary && (
                    <div className="p-1">
                      <div className={`overflow-hidden rounded-md ${T.card}`}>
                        {docThumbs[m.objectKey] ? (
                          <img src={docThumbs[m.objectKey]} alt="Itinerary preview" className="max-h-60 w-full object-cover object-top" />
                        ) : (
                          <div className={`grid h-28 animate-pulse place-items-center ${T.cardEmpty}`}><RefreshCw className={`h-8 w-8 animate-spin ${T.ghost}`} /></div>
                        )}
                        <div className="flex items-center gap-2.5 px-3 py-2.5"><span className="grid h-8 w-7 shrink-0 place-items-center rounded bg-red-500 text-[8px] font-bold text-white">{/\.pdf$/i.test(m.fileName) ? 'PDF' : 'DOC'}</span><span className="min-w-0 truncate text-[12px] font-semibold">{m.fileName}</span></div>
                      </div>
                    </div>
                  )}
                  <div className="px-3 pb-1 pt-2 text-[13.5px] leading-[1.35rem]">
                    <p className="whitespace-pre-wrap">{m.isPrimary ? `That's the same ${((n, d) => (Number(n) > 0 ? `${n} Night${Number(n) === 1 ? '' : 's'} / ${d} Day${Number(d) === 1 ? '' : 's'}` : `${d} Day${Number(d) === 1 ? '' : 's'}`))(m.nights, m.days)} itinerary we already sent you above 👆` : `You've chosen this itinerary -- ${m.nights} Nights / ${m.days} Days -- here it is! 📥`}</p>
                    <p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:31 am <span className="text-sky-400">✓✓</span></p>
                  </div>
                </div>
              ) : m.kind === 'allSent' ? (
                <div className={`overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                  <div className="px-3 py-2.5 text-[13.5px] leading-[1.35rem]">
                    <p className="whitespace-pre-wrap">You've already got every itinerary length we have for this trip! 🙏{contactNumber.trim() ? `\n\n📞 Want to talk it through? Call our expert: ${contactName.trim() ? contactName.trim() + ' · ' : ''}${contactNumber.trim()}` : ''}</p>
                    <p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:31 am <span className="text-sky-400">✓✓</span></p>
                  </div>
                </div>
              ) : m.kind === 'calledBack' ? (
                <div className={`overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                  <div className="px-3 py-2.5 text-[13.5px] leading-[1.35rem]">
                    <p className="whitespace-pre-wrap">Thanks! Our travel expert will call you shortly. 🙏</p>
                    <p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:31 am <span className="text-sky-400">✓✓</span></p>
                  </div>
                </div>
              ) : (
                // Real WhatsApp quick-reply buttons message, matches askExploreMore on the
                // backend. "Explore More Itineraries" reopens the duration sheet (or, once
                // everything's been sent, goes straight to the call-our-experts message); "Call
                // our experts" shows the consultant's real name/number, same as tapping it on
                // the original package message.
                <div className={`overflow-hidden rounded-lg rounded-tr-none shadow ${T.bubble}`}>
                  <div className="px-3 py-2.5 text-[13.5px]">
                    <p>Would you like to select another itinerary?</p>
                    <p className={`mt-1 text-right text-[10px] ${T.sub}`}>10:31 am <span className="text-sky-400">✓✓</span></p>
                  </div>
                  <button type="button" onClick={openDurationSheet} className={`flex w-full items-center justify-center gap-2 border-t py-2.5 text-[13px] font-semibold ${T.line} ${T.btn}`}><List className="h-4 w-4"/>Explore More Itineraries</button>
                  <button type="button" onClick={simulateCallExperts} className={`flex w-full items-center justify-center gap-2 border-t py-2.5 text-[13px] font-semibold ${T.line} ${T.btn}`}><PhoneCall className="h-4 w-4"/>Call our experts</button>
                </div>
              )}
            </div>
          ))}
          {simMessages.length > 0 && <button type="button" onClick={() => setSimMessages([])} className="mx-auto mt-3 block text-[11px] font-semibold text-slate-400 underline hover:text-slate-600">↺ Reset simulation</button>}
        </div>
        <div className={`flex gap-2 p-2 ${T.foot}`}><div className={`flex-1 rounded-full px-4 py-2 text-xs ${T.input}`}>Type a message</div><div className="grid h-9 w-9 place-items-center rounded-full bg-[#00a884] text-white"><Send className="h-4 w-4"/></div></div>
        {openListFor !== null && (
          <div className="absolute inset-0 z-10 flex items-end bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenListFor(null); }}>
            <div className="max-h-[70%] w-full overflow-y-auto rounded-t-2xl bg-white pb-2 shadow-2xl">
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" />
              <p className="px-4 pb-2 pt-3 text-sm font-bold text-navy">Available Durations</p>
              {remainingCandidates.map((c) => (
                <button key={c.id} type="button" onClick={() => simulatePick(c)} className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-slate-300" />
                  <span><span className="block text-sm font-semibold text-slate-800">{c.label}{c.isDuplicate ? ` (same as Option ${(c.duplicateOfOption ?? 0)})` : ''}</span><span className="block text-xs text-slate-500">Different duration</span></span>
                </button>
              ))}
              <button type="button" onClick={simulatePickCustom} className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-slate-300" />
                <span><span className="block text-sm font-semibold text-slate-800">Need other days/nights?</span><span className="block text-xs text-slate-500">Tell us what you have in mind</span></span>
              </button>
              <button type="button" onClick={() => setOpenListFor(null)} className="mt-1 w-full py-2.5 text-center text-sm font-semibold text-red-600">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </aside>;
  };

  // Persistent, always-visible tag (not just a creation-time warning) when this itinerary shares
  // a campaign with another one -- confirmed intentional (customers pick between duration
  // options), but staff said the lack of an always-visible indicator on the edit page itself was
  // confusing ("this is a duplicate... you are creating a second one").
  const otherSiblings = campaignSiblings.filter((p: any) => p.id !== pkg?.id);
  return <div className="space-y-5">
    {otherSiblings.length > 0 && (
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
        <span className="font-semibold">Shares this campaign with {otherSiblings.length} other itinerary{otherSiblings.length>1?'s':''}:</span>{' '}
        {otherSiblings.map((p: any, i: number) => <span key={p.id}>{i>0 && ', '}<Link href={`/packages/${p.id}`} className="underline hover:text-sky-900">{p.name}</Link></span>)}
        <span className="ml-1 text-sky-600">— intentional, these are the duration options "Explore More Itineraries" offers.</span>
      </div>
    )}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{STEPS.map((label,index)=>{const number=index+1;const done=number<step || (number===5&&active);return <button type="button" key={label} onClick={()=>number<step&&setStep(number)} className={`rounded-xl border px-3 py-3 text-left text-xs font-bold ${number===step?'border-gold bg-gold/10 text-navy shadow-sm':done?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-slate-200 bg-slate-50 text-slate-400'}`}><span className={`mr-2 inline-grid h-5 w-5 place-items-center rounded-full ${number===step?'bg-gold text-navy':done?'bg-emerald-500 text-white':'bg-slate-200'}`}>{done?<Check className="h-3 w-3"/>:number}</span>{label}</button>})}</div>

    <div className="grid items-start gap-6" style={{gridTemplateColumns:'minmax(0, 1fr) minmax(300px, 380px)'}}>
      <section className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        {step===1 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">Stage 1 of 5</p><h2 className="mt-2 text-2xl font-bold text-navy">Select Meta campaign</h2><p className="mt-1 text-sm text-muted-foreground">Destination and itinerary name will fill automatically from the campaign.</p></div><div><div className="flex items-center justify-between"><Label>Meta campaign *</Label><button type="button" onClick={()=>refetch()} className="flex items-center gap-1 text-xs font-semibold text-gold"><RefreshCw className={`h-3.5 w-3.5 ${isFetching?'animate-spin':''}`}/>Refresh</button></div><div className="relative mt-2"><Input value={campaignName} onChange={(e)=>{setCampaignName(e.target.value);setCampaignOpen(true)}} onFocus={()=>setCampaignOpen(true)} onBlur={()=>setTimeout(()=>setCampaignOpen(false),150)} placeholder="Type to search campaigns, e.g. Kashmir" className={`h-12 w-full text-sm ${otherSiblings.length>0?'border-amber-400 ring-1 ring-amber-200':''}`}/>{otherSiblings.length>0 && <p className="mt-1.5 text-xs font-semibold text-amber-700">⚠ This campaign already has {otherSiblings.length} other {otherSiblings.length>1?'itineraries':'itinerary'} — see the note above before changing it.</p>}{campaignOpen&&(campaignsLoading?<div className="absolute z-10 mt-1 w-full rounded-xl border border-input bg-background p-3 text-xs text-muted-foreground shadow-lg">Loading campaigns…</div>:filteredCampaigns.length>0?<div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-input bg-background shadow-lg">{filteredCampaigns.map(c=><button type="button" key={c.id} onMouseDown={()=>{setCampaignName(c.name);setCampaignOpen(false)}} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-gold/10"><span className="min-w-0 flex-1 truncate">{c.name}</span>{campaignsWithItinerary.has(c.name) && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Existing itinerary</span>}<span className="shrink-0 text-xs text-muted-foreground">{c.effective_status||c.status}</span></button>)}</div>:<div className="absolute z-10 mt-1 w-full rounded-xl border border-input bg-background p-3 text-xs text-muted-foreground shadow-lg">No campaigns match &quot;{campaignName}&quot;.</div>)}</div></div>
        {existingForCampaign.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">This campaign already has an itinerary — adding another one here would create a duplicate.</p>
          <p className="mt-1 text-xs">If you meant to add a second day/night option to the same campaign, open the existing itinerary below and use "+ Add Itinerary" inside it instead.</p>
          <div className="mt-2 space-y-1">{existingForCampaign.map((p: any) => <Link key={p.id} href={`/packages/${p.id}`} className="block text-xs font-semibold text-navy underline">{p.name} — open existing itinerary</Link>)}</div>
        </div>}
        {!pkg && campaignName.trim() && !campaignMatchesMeta && (
          <div className="space-y-2">
            {!testItinerary && <p className="text-xs font-semibold text-red-600">Select an existing campaign from the list — this name doesn't match any real Meta campaign, so a typed-only name would never actually reach anyone.</p>}
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-gold" checked={testItinerary} onChange={(e) => setTestItinerary(e.target.checked)} />
              <span><b>This is a test itinerary.</b> It won't be linked to any campaign, so customers never receive it automatically — you send it only to your test numbers (stage 4) to check the message, the buttons and the Explore More chain.</span>
            </label>
          </div>
        )}
        <div className="flex justify-end"><Button type="button" variant="gold" disabled={!campaignIsReal} onClick={()=>setStep(2)} className="gap-2">Next: Content & Upload <ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===2 && <><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-gold">Stage 2 of 5</p><h2 className="mt-2 text-2xl font-bold text-navy">Content & itinerary</h2><p className="mt-1 text-sm text-muted-foreground">Campaign details are filled automatically. Upload and preview before saving.</p></div><Button type="button" variant="gold" disabled={saving||uploading||!objectKey||nights===''} onClick={saveDraft}>{saving?'Saving…':'Save & continue'}</Button></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>Destination *</Label><Input className="mt-1.5" value={destination} onChange={e=>setDestination(e.target.value)} list="destinations"/><datalist id="destinations">{DESTINATIONS.map(d=><option key={d}>{d}</option>)}</datalist></div><div><Label>Display name</Label><Input className="mt-1.5" value={name} onChange={e=>setName(e.target.value)}/></div><div><Label>Consultant name</Label><PresetField items={byKind('name')} value={contactName} onChange={setContactName} actions={listActions('name')} placeholder="e.g. Priya"/></div></div><div><div className="flex items-center justify-between"><Label>WhatsApp introduction message</Label><button type="button" onClick={()=>{setTemplate('');setMessageEdited(false);setMessage(fillTemplate(DEFAULT_TEMPLATE,destination,shortDuration(days,nights)));toast('Reset to the default wording','success');}} className="text-xs font-semibold text-slate-500 underline hover:text-gold">Reset to default</button></div><MessageTemplatePicker items={byKind('message')} actions={listActions('message')} onPick={(t)=>{setTemplate(t);setMessageEdited(false);setMessage(fillTemplate(t,destination,shortDuration(days,nights)));}} onSaveCurrent={()=>{let v=destination?message.replace(new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'{destination}'):message;const sd=shortDuration(days,nights);if(sd.trim())v=v.replace(new RegExp(sd.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'),'{duration}');if(v.trim())presetActions.add.mutate({kind:'message',value:v.trim()});}}/><textarea rows={5} value={message} onChange={e=>{setMessage(e.target.value);setMessageEdited(true)}} className="mt-1.5 w-full rounded-xl border border-input p-3 text-sm outline-none focus:border-gold"/></div><div className="rounded-xl border border-gold/30 bg-gold/5 p-4"><p className="text-sm font-bold text-navy">Buttons under the message</p>
          {buttons.map((b, i) => <div key={i} data-btn-row={i} className="mt-2 rounded-lg bg-white p-2 shadow-sm transition-shadow">
            <div className="flex flex-wrap items-center gap-2"><span className="w-[4.5rem] shrink-0 rounded-full bg-slate-100 px-2 py-1 text-center text-[11px] font-bold uppercase text-slate-600">{b.type === 'call' ? 'Call' : b.type === 'url' ? 'Website' : b.type === 'duration' ? 'Utility' : 'Chat'}</span><div className="min-w-[8rem] flex-1"><PresetField className="!mt-0" items={byKind('button')} value={b.text} maxLength={25} onChange={(v) => updateButton(i, { text: v })} actions={listActions('button')} placeholder="Button text"/></div>{b.type === 'call' && <div className="min-w-[11rem] flex-1"><PresetField className="!mt-0" items={byKind('number')} value={b.phone || ''} inputMode="tel" onChange={(v) => updateButton(i, { phone: v })} actions={listActions('number')} placeholder="Number to call, e.g. 06 12 34 56 78"/>{b.phone?.trim() && !mobileDigits(b.phone) && <p className="mt-1 text-[11px] font-semibold text-red-600">Not a valid phone number (add the country code for numbers outside France)</p>}</div>}{b.type === 'url' && <div className="min-w-[11rem] flex-1"><PresetField className="!mt-0" items={byKind('link')} value={b.url || ''} onChange={(v) => updateButton(i, { url: v })} actions={listActions('link')} placeholder="https://your-website.com/page"/></div>}{b.type === 'chat' && <div className="min-w-[11rem] flex-1"><PresetField className="!mt-0" items={byKind('number')} value={b.phone || ''} inputMode="tel" onChange={(v) => updateButton(i, { phone: v, replyTouched: true })} actions={listActions('number')} placeholder="WhatsApp number to chat (follows the Call number)"/>{b.phone?.trim() && !mobileDigits(b.phone) && <p className="mt-1 text-[11px] font-semibold text-red-600">Not a valid phone number (add the country code for numbers outside France)</p>}</div>}{b.type === 'chat' && <div className="w-full min-w-[11rem] pl-[4.75rem]"><PresetField className="!mt-0" items={byKind('reply')} value={b.reply ?? ''} onChange={(v) => updateButton(i, { reply: v })} actions={listActions('reply')} placeholder="Message they start with, e.g. Hi, I am interested to know more about {destination}"/></div>}<button type="button" onClick={() => setButtons((list) => list.filter((_, idx) => idx !== i))} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label="Remove button"><X className="h-4 w-4"/></button></div>
            {b.type === 'duration' && (
              <div className="ml-[5rem] mt-1.5 space-y-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Prompt shown when this is tapped</p>
                  <PresetField className="!mt-1" items={byKind('reply')} value={b.reply ?? 'Which duration would you like to see?'} onChange={(v) => updateButton(i, { reply: v })} actions={listActions('reply')} placeholder="Which duration would you like to see?"/>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Options customers will see (from the itinerary documents below, not editable here)</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {labeledDurationOptions.length ? labeledDurationOptions.map((o, idx) => <span key={o.key} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${o.isDuplicate ? 'bg-amber-200 text-amber-900' : 'bg-gold/15 text-navy'}`}>Option {idx + 1}: {o.label}{o.isDuplicate ? ` (same as Option ${o.duplicateOfOption})` : ''}</span>) : <span className="text-[11px] text-slate-400">None yet -- fill in Days/Nights on an itinerary below</span>}
                    {/* Always appended by the bot itself (see sendDurationOptionsList in
                        whatsapp-bot.service.ts) -- shown here too so this preview matches what
                        customers actually see. Typing an answer to it gets flagged to staff on
                        the Callback Requests list instead of silently auto-matched. */}
                    {labeledDurationOptions.length >= 1 && <span title="Asks them to type it, flags our team" className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-bold text-navy">Option {labeledDurationOptions.length + 1}: {b.customLabel?.trim() || 'Need other days/nights?'}</span>}
                  </div>
                </div>
                {labeledDurationOptions.length >= 1 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Last option's title (default shown above -- change it if you'd like different wording)</p>
                    <PresetField className="!mt-1" items={byKind('reply')} value={b.customLabel ?? 'Need other days/nights?'} onChange={(v) => updateButton(i, { customLabel: v })} actions={listActions('reply')} placeholder="Need other days/nights?"/>
                  </div>
                )}
              </div>
            )}
          </div>)}
          {!buttons.length && <p className="mt-2 text-xs text-muted-foreground">No buttons — the message goes out with text and document only.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={buttonCounts.call >= 1} onClick={() => setButtons((list) => [...list, { type: 'call', text: 'Call our experts', phone: '' }])} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold disabled:opacity-40">+ Call</button>
            <button type="button" disabled={nonCallButtonCount >= 2} onClick={() => setButtons((list) => [...list, { type: 'url', text: 'Visit website', url: '' }])} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold disabled:opacity-40">+ Website link</button>
            <button type="button" disabled={nonCallButtonCount >= 2} onClick={() => setButtons((list) => [...list, { type: 'chat', text: 'Chat with us', phone: list.find((x) => x.type === 'call')?.phone || '', reply: 'Hi, I am interested to know more about {destination}' }])} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold disabled:opacity-40">+ Chat</button>
          </div>
          {/* No manual "+ Duration options" button -- the Utility button is fully automatic
              (added once 2+ durations exist, removed if it drops back below), so there's
              nothing to add or remove by hand here. */}
          <div className="relative mt-2 inline-block">
            <button type="button" onClick={() => setButtonsInfoOpen((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-gold">
              <Info className="h-3.5 w-3.5" />How these buttons work
            </button>
            {buttonsInfoOpen && (
              <div className="absolute left-0 top-full z-20 mt-1.5 w-80 rounded-xl border border-gold/30 bg-white p-3 text-xs leading-relaxed text-muted-foreground shadow-lg">
                Call opens the phone dialer. Chat opens WhatsApp with its number and starting message already typed, following the Call number until changed. Website opens a link. The Utility button appears automatically once 2 or more itineraries (with Days/Nights filled in) exist -- shows a tappable list of every duration, picking one sends that document and offers to explore another, all free session messages, no extra Meta approval. Up to 1 call + 2 more buttons; 25 characters each. Changing a button's text/number/link needs a new one-time Meta approval.
              </div>
            )}
          </div></div>
          <div data-field="itinerary-1" className="rounded-xl transition-shadow"><Label>Itinerary document 1 *</Label>
            <div className="mt-2 flex items-center gap-2"><NumberPicker value={days} placeholder="Days" highlight={nights === ''} onChange={(d)=>{const n=d?String(Math.max(Number(d)-1,0)):'';setDays(d);setNights(n);if(destination&&(!name||name.startsWith(destination)))setName(`${destination} ${durationLabel(d,n)} Itinerary`.replace(/\s+/g,' '));}}/><NumberPicker value={nights} placeholder="Nights *" highlight={nights === ''} onChange={(n)=>{setNights(n);if(destination&&(!name||name.startsWith(destination)))setName(`${destination} ${durationLabel(days,n)} Itinerary`.replace(/\s+/g,' '));}}/><span className="rounded-full bg-gold px-3 py-1 text-sm font-bold text-navy shadow-sm">Itinerary 1</span></div>
            {duplicateWarningFor('primary') && <p className="mt-1.5 text-[11px] font-semibold text-amber-700">⚠ Same Days/Nights as Option {duplicateWarningFor('primary')?.duplicateOfOption} -- fine if this is a different place, otherwise pick different Days/Nights so customers can tell them apart.</p>}
            {objectKey && nights === '' && <p className="mt-1.5 text-[11px] font-semibold text-red-600">Choose Days and Nights for this itinerary — the "Explore More Itineraries" list on WhatsApp is built from them.</p>}
            {objectKey?<DocThumbCard label={`Itinerary 1${days ? ` · ${durationLabel(days, nights)}` : ''}`} busy={uploading} thumb={/\.(jpe?g|png|webp)$/i.test(fileName) ? previewUrl : pageImg} fileName={fileName} onView={()=>viewDocument(objectKey)} onReplace={upload} onRemove={()=>{setObjectKey('');setFileName('');setPageImg('');setPreviewUrl('')}}/>:nights === '' ? <p className="mt-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs font-semibold text-slate-500">Enter Days and Nights above first -- the "Explore More Itineraries" option on WhatsApp is built from them, so the itinerary can't be uploaded without them.</p>:<label className="mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gold/40 bg-gold/5 p-8"><Upload className="h-8 w-8 text-gold"/><span className="text-sm font-semibold">{uploading?'Uploading…':'Choose itinerary file'}</span>{uploading && progress && <div className="w-full max-w-xs"><div className="h-2 overflow-hidden rounded-full bg-gold/20"><div className="h-full rounded-full bg-gold transition-all" style={{width:`${Math.min(100,Math.round(progress.loaded/progress.total*100))}%`}}/></div><p className="mt-1 text-center text-xs font-semibold text-navy">{(progress.loaded/1048576).toFixed(1)} MB of {(progress.total/1048576).toFixed(1)} MB · {Math.min(100,Math.round(progress.loaded/progress.total*100))}%</p></div>}<input type="file" hidden disabled={uploading} onChange={upload}/></label>}
          </div>
          <div>
            {(pkg ? documents : draftDocs).map((doc: any, i) => (
              <div key={doc.id ?? doc.key} className="mb-4">
                <div className="flex items-center gap-2"><Label>Itinerary document {i+2}</Label></div>
                <div className="mt-2 flex items-center gap-2">
                  <NumberPicker placeholder="Days" value={String(pkg ? (doc.duration_days ?? '') : doc.days)} onChange={(d)=>{const n=d?String(Math.max(Number(d)-1,0)):'';if(pkg)updateDocument.mutate({id:doc.id,durationDays:d?Number(d):undefined,durationNights:n?Number(n):undefined});else setDraftDocs((list)=>list.map((x)=>x.key===doc.key?{...x,days:d,nights:n}:x));}}/>
                  <NumberPicker placeholder="Nights" value={String(pkg ? (doc.duration_nights ?? '') : doc.nights)} onChange={(n)=>{if(pkg)updateDocument.mutate({id:doc.id,durationDays:doc.duration_days??undefined,durationNights:n?Number(n):undefined});else setDraftDocs((list)=>list.map((x)=>x.key===doc.key?{...x,nights:n}:x));}}/>
                  <span className="rounded-full bg-gold px-3 py-1 text-sm font-bold text-navy shadow-sm">Itinerary {i+2}</span>
                </div>
                {duplicateWarningFor(String(doc.id ?? doc.key)) && <p className="mt-1.5 text-[11px] font-semibold text-amber-700">⚠ Same Days/Nights as Option {duplicateWarningFor(String(doc.id ?? doc.key))?.duplicateOfOption} -- fine if this is a different place, otherwise pick different Days/Nights so customers can tell them apart.</p>}
                <DocThumbCard label={`Itinerary ${i+2}${(pkg ? doc.duration_days : doc.days) ? ` · ${durationLabel(String(pkg ? (doc.duration_days ?? '') : doc.days), String(pkg ? (doc.duration_nights ?? '') : doc.nights))}` : ''}`} busy={replacingDoc === String(doc.id ?? doc.key)} thumb={docThumbs[doc.object_key ?? doc.objectKey]} fileName={doc.file_name ?? doc.fileName} onView={()=>viewDocument(doc.object_key ?? doc.objectKey)} onReplace={(e)=>{const f=e.target.files?.[0]; e.target.value=''; if(f) replaceDocumentFile(doc, f);}} onRemove={()=>removeDocumentFile(doc)}/>
              </div>
            ))}
            {pendingSlots.map((slot, i) => (
              <div key={slot.key} className="mb-2">
                <div className="flex items-center gap-2"><Label>Itinerary document {(pkg?documents.length:draftDocs.length)+i+2}</Label><button type="button" onClick={()=>setPendingSlots((list)=>list.filter((s)=>s.key!==slot.key))} className="ml-auto text-xs font-semibold text-slate-400 hover:text-red-500">Cancel</button></div>
                <div className="mt-2 flex items-center gap-2"><NumberPicker value={slot.days} placeholder="Days" highlight={slot.nights === ''} onChange={(d)=>setPendingSlots((list)=>list.map((s)=>s.key===slot.key?{...s,days:d,nights:d?String(Math.max(Number(d)-1,0)):''}:s))}/><NumberPicker value={slot.nights} placeholder="Nights *" highlight={slot.nights === ''} onChange={(n)=>setPendingSlots((list)=>list.map((s)=>s.key===slot.key?{...s,nights:n}:s))}/><span className="rounded-full bg-gold px-3 py-1 text-sm font-bold text-navy shadow-sm">Itinerary {(pkg?documents.length:draftDocs.length)+i+2}</span></div>
                {duplicateWarningFor(slot.key) && <p className="mt-1.5 text-[11px] font-semibold text-amber-700">⚠ Same Days/Nights as Option {duplicateWarningFor(slot.key)?.duplicateOfOption} -- fine if this is a different place, otherwise pick different Days/Nights so customers can tell them apart.</p>}
                {slot.nights === '' ? (
                  <p className="mt-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs font-semibold text-slate-500">Enter Nights above first -- it's what the "Explore More Itineraries" option on WhatsApp is built from, so a document can't be uploaded without it.</p>
                ) : (
                  <label className="mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gold/40 bg-gold/5 p-8"><Upload className="h-8 w-8 text-gold"/><span className="text-sm font-semibold">{uploadingSlot===slot.key?'Uploading…':'Choose itinerary file'}</span>{uploadingSlot===slot.key && slotProgress && <div className="w-full max-w-xs"><div className="h-2 overflow-hidden rounded-full bg-gold/20"><div className="h-full rounded-full bg-gold transition-all" style={{width:`${Math.min(100,Math.round(slotProgress.loaded/slotProgress.total*100))}%`}}/></div><p className="mt-1 text-center text-xs font-semibold text-navy">{(slotProgress.loaded/1048576).toFixed(1)} MB of {(slotProgress.total/1048576).toFixed(1)} MB · {Math.min(100,Math.round(slotProgress.loaded/slotProgress.total*100))}%</p></div>}<input type="file" hidden disabled={uploadingSlot===slot.key} onChange={(e)=>uploadAdditionalDocument(e,slot)}/></label>
                )}
              </div>
            ))}
            <Button type="button" variant="gold" disabled={!objectKey || nights === ''} onClick={()=>setPendingSlots((list)=>[...list,{key:`${Date.now()}-${Math.random()}`,days:'',nights:''}])} className="w-full gap-1.5"><Plus className="h-4 w-4"/>Add Itinerary</Button>
            {(!objectKey || nights === '') && <p className="mt-1 text-center text-[11px] text-muted-foreground">Upload Itinerary 1 with its Days and Nights first.</p>}
          </div>
          <div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(1)} className="gap-2"><ChevronLeft className="h-4 w-4"/>Back</Button><Button type="button" variant="gold" disabled={saving||uploading||!objectKey} onClick={saveDraft} className="gap-2">{saving?'Saving…':'Save & continue'} <ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===3 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">Stage 3 of 5</p><h2 className="mt-2 text-2xl font-bold text-navy">Meta approval</h2><p className="mt-1 text-sm text-muted-foreground">WhatsApp only allows business messages with buttons after Meta approves the template. Submit it here and watch the status — testing unlocks once it is approved.</p></div>{!pkg?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">Save the previous stage first to create the template.</p>:<>
          <CampaignItineraries campaignName={campaignName} currentId={pkg.id} destination={destination}/>
          {(() => {
            const quality: Record<string,string> = { GREEN:'High', YELLOW:'Medium', RED:'Low', UNKNOWN:'Not rated yet' };
            const reasonText: Record<string,string> = { INCORRECT_CATEGORY:'Meta thinks the message is a different category than declared (for example promotional wording in a utility template).', INVALID_FORMAT:'The template layout or variables are not in an allowed format (for example a variable at the start or end, or too many variables for the length).', ABUSIVE_CONTENT:'Meta flagged the wording as abusive or inappropriate.', SCAM:'Meta flagged the content as possibly misleading or a scam.', TAG_CONTENT_MISMATCH:'The content does not match the template type chosen.' };
            const statusLabel = (st: string) => ({ APPROVED:'Approved', REJECTED:'Rejected', PENDING:'In review', NOT_SUBMITTED:'Not submitted' } as Record<string,string>)[st] || st.replace(/_/g,' ');
            const box = (st: string) => ({ APPROVED:'border-emerald-200 bg-emerald-50', REJECTED:'border-red-200 bg-red-50', PENDING:'border-amber-200 bg-amber-50', NOT_SUBMITTED:'border-slate-200 bg-slate-50' } as Record<string,string>)[st] || 'border-slate-200 bg-slate-50';
            const chip = (st: string) => ({ APPROVED:'bg-emerald-500 text-white', REJECTED:'bg-red-500 text-white', PENDING:'bg-amber-500 text-white', NOT_SUBMITTED:'bg-slate-300 text-slate-700' } as Record<string,string>)[st] || 'bg-slate-300 text-slate-700';
            type Row = { key: string; label: string; status: string; reason: string; rejectedCode: string | null; category: string; quality: string; lastUpdated: string };
            const rows: Row[] = [
              { key: 'primary', label: durationLabel(days,nights) || fileName || 'Itinerary 1', status: templateStatus, reason: templateReason, rejectedCode: metaDetails?.rejected_reason || null,
                category: metaDetails?.category || (templateStatus !== 'NOT_SUBMITTED' ? 'MARKETING' : '—'), quality: metaDetails?.quality ? (quality[metaDetails.quality] || metaDetails.quality) : 'Not rated yet',
                lastUpdated: metaDetails?.last_updated ? new Date(Number(metaDetails.last_updated) * 1000 || metaDetails.last_updated).toLocaleString('en-IN') : '—' },
              ...documents.map((doc: PackageDocument, i) => { const dm = docMetaDetails[doc.id]; return {
                key: doc.id, label: durationLabel(String(doc.duration_days??''),String(doc.duration_nights??'')) || doc.file_name || `Itinerary ${i+2}`,
                status: doc.whatsapp_template_status || 'NOT_SUBMITTED', reason: doc.whatsapp_template_rejection_reason || '', rejectedCode: dm?.rejected_reason || null,
                category: dm?.category || (doc.whatsapp_template_status && doc.whatsapp_template_status !== 'NOT_SUBMITTED' ? 'MARKETING' : '—'),
                quality: dm?.quality ? (quality[dm.quality] || dm.quality) : 'Not rated yet',
                lastUpdated: dm?.last_updated ? new Date(Number(dm.last_updated) * 1000 || dm.last_updated).toLocaleString('en-IN') : '—' };
              }),
            ];
            const approvedCount = rows.filter((r) => r.status === 'APPROVED').length;
            const anySubmittable = rows.some((r) => r.status === 'NOT_SUBMITTED' || r.status === 'REJECTED');
            return <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4">
                  <div className="min-w-[12rem] flex-1"><p className="text-sm font-bold text-navy">Meta template status</p><p className="text-xs text-muted-foreground">{rows.length>1 ? <>{rows[0].status==='APPROVED' ? 'Itinerary 1 is approved — you can test now.' : 'Only Itinerary 1 needs Meta approval before you can test.'} The other itineraries go free inside the 24-hour chat after the customer taps Explore, so they don't need to wait for their own approval.</> : <>{approvedCount} of {rows.length} approved</>} · updates automatically</p><div className="mt-2 h-2 max-w-xs overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(approvedCount / rows.length) * 100}%` }}/></div></div>
                  {anySubmittable && <p className="text-xs font-semibold text-slate-500">Scroll down to submit ↓</p>}
                </div>
                <div className="divide-y">
                  {rows.map((r) => <div key={r.key} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3">
                    <p className="min-w-[10rem] flex-1 text-sm font-semibold text-navy">{r.label}</p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip(r.status)}`}>{statusLabel(r.status)}</span>
                    <span className="w-24 shrink-0 text-xs text-slate-500">{r.category}</span>
                    <span className="w-28 shrink-0 text-xs text-slate-500">{r.lastUpdated}</span>
                  </div>)}
                </div>
              </div>
              {rows.map((r) => <div key={r.key} className={`rounded-xl border p-5 ${box(r.status)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-navy">{r.label}</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip(r.status)}`}>{statusLabel(r.status)}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div><p className="font-semibold uppercase text-muted-foreground">Category</p><p className="mt-0.5 text-slate-700">{r.category}</p></div>
                  <div><p className="font-semibold uppercase text-muted-foreground">Quality</p><p className="mt-0.5 text-slate-700">{r.quality}</p></div>
                  <div><p className="font-semibold uppercase text-muted-foreground">Last updated</p><p className="mt-0.5 text-slate-700">{r.lastUpdated}</p></div>
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-800">{r.status==='APPROVED'?'Why it is approved':r.status==='REJECTED'?'Why it was rejected':r.status==='PENDING'?'Why it is still loading':'Not submitted yet'}</p>
                <p className="mt-1 text-xs text-slate-700">
                  {r.status==='APPROVED' && 'Meta reviews templates automatically against its messaging policy. This one passed: the wording is not misleading, the variables are laid out correctly, and the buttons are in an allowed format.'}
                  {r.status==='REJECTED' && <>{r.rejectedCode ? (reasonText[r.rejectedCode] || r.rejectedCode) : (r.reason || 'Meta did not give a reason. Open WhatsApp Manager → Message templates to see its note.')} Edit the message in Stage 2, save, and submit again.</>}
                  {r.status==='PENDING' && 'Meta is reviewing it. Most templates are decided within minutes; some take up to 24 hours. This page updates the instant Meta sends its decision (a live connection, not a fixed wait) — nothing is wrong with it yet.'}
                  {r.status==='NOT_SUBMITTED' && 'Use "Submit for approval" above to start Meta’s review.'}
                </p>
                {r.status==='PENDING' && (
                  <details className="mt-2 rounded-lg border border-amber-200 bg-white/60 p-3 text-xs text-slate-700">
                    <summary className="cursor-pointer font-semibold text-slate-800">What is Meta actually checking right now?</summary>
                    <div className="mt-2 space-y-2">
                      <div>
                        <p className="font-semibold text-slate-800">Automatic, usually instant checks</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          <li>Variable syntax and placement — no {'{{'}1{'}}'}-style variable sitting at the very start or end with no real text around it</li>
                          <li>An example value filled in for every variable</li>
                          <li>No duplicate or missing variable numbers</li>
                          <li>Header media (the itinerary file) actually matches its declared type — image vs document</li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">Slower content-policy review (this is what usually takes the extra minutes-to-hours)</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          <li><b>Category accuracy</b> — this is submitted as MARKETING, so Meta checks it genuinely reads as marketing, not disguised spam or a mislabeled utility message</li>
                          <li><b>Content policy</b> — no misleading pricing, no fake urgency, no deceptive claims about the trip</li>
                          <li><b>Brand legitimacy</b> — the message should clearly represent Errances Voyages, not look impersonated or unrelated</li>
                          <li><b>Spam/quality signals</b> — excessive emojis, ALL CAPS, or aggressive sales language can slow this down</li>
                          <li><b>Opt-in basis</b> — whether there's a legitimate reason to message this audience (your Meta ad leads already have this, which is the correct basis)</li>
                        </ul>
                      </div>
                      <p className="text-slate-500">If it's rejected, the specific reason will replace this box automatically — Meta always gives one. There's nothing you need to do while it's reviewing; this page checks for the result on its own every 20 seconds.</p>
                    </div>
                  </details>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">{r.category==='MARKETING' ? 'MARKETING category — billed per delivered conversation on your WhatsApp Business invoice.' : 'Pricing depends on category, set by Meta on your WhatsApp Business invoice.'}</p>
              </div>)}
              {anySubmittable && <div className="sticky bottom-0 z-10 -mx-1 mt-4 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur"><Button type="button" variant="gold" className="w-full" disabled={submittingAll} onClick={submitAllTemplates}>{submittingAll?'Submitting…':`Submit ${rows.length>1?'all':''} for approval`}</Button></div>}
            </div>;
          })()}
        </>}<div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(2)} className="gap-2"><ChevronLeft className="h-4 w-4"/>Back</Button><Button type="button" variant="gold" disabled={templateStatus!=='APPROVED'||!allDocsApproved||!allCampaignApproved} onClick={()=>setStep(4)} className="gap-2">{templateStatus==='APPROVED'&&allDocsApproved&&allCampaignApproved?'Next: Test message':!allCampaignApproved&&templateStatus==='APPROVED'&&allDocsApproved?'Waiting for sibling itinerary…':'Waiting for approval…'} <ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===4 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">Stage 4 of 5</p><h2 className="mt-2 text-2xl font-bold text-navy">Test message</h2><p className="mt-1 text-sm text-muted-foreground">Send the approved message to one of your test numbers and check how it looks on the phone: document, text and both buttons.</p></div>{pkg && templateStatus==='APPROVED' ? <><div><Label>Test numbers</Label><TestNumbersPicker list={testList} selected={selectedTestNumbers} onToggle={toggleTestNumber} onAdd={addAndSelectTestNumber} onUpdate={updateTestNumber} onRemove={removeTestNumber}/><p className="mt-1 text-xs text-muted-foreground">Select up to {MAX_TEST_NUMBERS} saved numbers, or type a new one to add and select it. Use the ⋮ menu next to a saved number to edit or delete it.</p></div><Button type="button" className="w-full gap-2" disabled={!selectedTestNumbers.length||sendTest.isPending||updateTestNumbers.isPending} onClick={()=>sendTestMessage()}><Send className="h-4 w-4"/>{sendTest.isPending?'Sending…':`Send test message${selectedTestNumbers.length>1?` (${selectedTestNumbers.length})`:''}`}</Button>{tested&&<p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">✓ Test accepted by WhatsApp. Check the phone, then continue.</p>}</> : <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">Testing unlocks after Meta approves the template (previous stage).</p>}<div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(3)} className="gap-2"><ChevronLeft className="h-4 w-4"/>Back</Button><Button type="button" variant="gold" disabled={templateStatus!=='APPROVED'} onClick={()=>setStep(5)} className="gap-2">Next: Activate <ChevronRight className="h-4 w-4"/></Button></div></>}

        {step===5 && <><div><p className="text-xs font-bold uppercase tracking-widest text-gold">Stage 5 of 5</p><h2 className="mt-2 text-2xl font-bold text-navy">Activate automation</h2><p className="mt-1 text-sm text-muted-foreground">One switch, one action: turning it on saves and immediately sends to every matching enquiry that hasn't received it yet; turning it off stops automatic sending.</p></div><div className={`flex items-center justify-between rounded-xl border p-5 ${pkg?.is_active?'border-emerald-200 bg-emerald-50':'border-slate-200'}`}><div><p className="font-bold">Automatic WhatsApp delivery</p><p className="mt-1 text-xs text-muted-foreground">Campaign: {campaignName}</p></div>{pkg ? <ActiveSwitch pkg={pkg} /> : <p className="text-xs text-muted-foreground">Save this itinerary first (Stage 2) to activate it.</p>}</div><div className="rounded-xl border border-slate-200 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-navy">Enquiries for this campaign</p><p className="text-xs text-muted-foreground">{delivery ? (delivery.campaign ? `Campaign: ${delivery.campaign}` : `Destination: ${delivery.destination}`) : 'Checking…'}</p></div>{delivery && <div className="flex gap-2 text-center text-xs"><div className="rounded-lg bg-slate-100 px-3 py-1.5"><p className="text-base font-bold text-navy">{delivery.total}</p>enquiries</div><div className="rounded-lg bg-emerald-50 px-3 py-1.5"><p className="text-base font-bold text-emerald-700">{delivery.sent}</p>sent</div><div className="rounded-lg bg-amber-50 px-3 py-1.5"><p className="text-base font-bold text-amber-700">{delivery.pending}</p>not sent</div></div>}</div>
            {delivery && delivery.leads.length > 0 && <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-100">{delivery.leads.map((lead) => <div key={lead.id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-0"><div className="min-w-0"><p className="truncate font-semibold text-navy">{lead.name}</p><p className="truncate text-muted-foreground">{lead.phone || 'No number'}{lead.enquiry ? ` · ${lead.enquiry}` : ''}</p></div><span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${lead.sent ? 'bg-emerald-100 text-emerald-700' : lead.validPhone ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{lead.sent ? `Accepted ${lead.sentAt ? new Date(lead.sentAt).toLocaleDateString('en-IN') : ''}` : lead.validPhone ? 'Not sent' : 'No valid number'}</span></div>)}</div>}
            {delivery && delivery.total === 0 && <p className="mt-3 text-xs text-muted-foreground">No enquiries match this campaign yet. New ones get the itinerary automatically.</p>}
            {delivery && delivery.stuckCount > 0 && <div className={`mt-3 rounded-lg p-3 text-xs ${delivery.throttled ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
              <p className="font-semibold">{delivery.autoPaused ? `Auto-paused${delivery.autoPausedAt ? ` since ${new Date(delivery.autoPausedAt).toLocaleString('en-IN')}` : ''} — ${delivery.stuckCount} recent sends never confirmed delivery.` : delivery.throttled ? `Meta appears to be throttling this campaign — ${delivery.stuckCount} recent sends never confirmed delivery.` : `${delivery.stuckCount} recent send(s) haven't confirmed delivery yet.`}</p>
              <p className="mt-1">{delivery.autoPaused ? 'Automatic sending (new leads and backlog) is paused for this itinerary and will resume on its own once Meta starts confirming delivery again — no action needed.' : delivery.throttled ? 'Suggested action: wait a few hours before sending any more — sending is paused automatically until this clears.' : 'This is usually just a short delay; keep an eye on it before sending another large batch.'}</p>
            </div>}
            {delivery && delivery.pending > 0 && <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="gold" disabled={!pkg?.is_active || templateStatus !== 'APPROVED' || sendPending.isPending || delivery.throttled} onClick={sendBacklog}>{sendPending.isPending ? 'Sending…' : delivery.throttled ? 'Paused — Meta cooldown' : `Send to ${delivery.pending} enquiries not sent`}</Button><p className="text-xs text-muted-foreground">{!pkg?.is_active ? 'Activate the itinerary first, then send.' : delivery.liveMode ? 'Live mode: real customers will receive it.' : 'Test mode is ON: only approved test numbers really receive it; others are skipped.'}</p></div>}
          </div>
          <div className="flex justify-between border-t pt-5"><Button type="button" variant="outline" onClick={()=>setStep(4)} className="gap-2"><ChevronLeft className="h-4 w-4"/>Back</Button><Button type="button" variant="gold" onClick={()=>router.push('/packages')}>Done</Button></div></>}
      </section>
      <PhonePreview/>
    </div>
  </div>;
}






const STATUS_STYLE: Record<string, string> = { APPROVED: 'bg-emerald-100 text-emerald-700', PENDING: 'bg-amber-100 text-amber-700', REJECTED: 'bg-red-100 text-red-700', NOT_SUBMITTED: 'bg-slate-100 text-slate-600' };
const STATUS_LABEL: Record<string, string> = { APPROVED: 'Approved', PENDING: 'In review', REJECTED: 'Rejected', NOT_SUBMITTED: 'Not submitted' };

// Every itinerary sharing this campaign (e.g. Vietnam 5D/4N and Vietnam 2D/1N) with its own Meta
// approval, so both templates can be watched in one place. Each is sent as its own message.
function CampaignItineraries({ campaignName, currentId }: { campaignName: string; currentId: string; destination: string }) {
  const router = useRouter();
  const { data } = usePackages();
  const siblings = (data?.data ?? []).filter((p: any) => !p.is_deleted && campaignName && p.campaign_name === campaignName);
  const status = (p: any) => p.whatsapp_template_status || 'NOT_SUBMITTED';
  const approved = siblings.filter((p: any) => status(p) === 'APPROVED').length;
  if (siblings.length < 1) return null;

  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-bold text-navy">Itineraries for this campaign</p><p className="text-xs text-muted-foreground">{siblings.length === 1 ? 'One itinerary.' : `Customers get all ${siblings.length}, one message each.`} {approved === siblings.length ? 'All approved — ready to send.' : `${approved} of ${siblings.length} approved.`}</p></div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(approved / siblings.length) * 100}%` }} /></div>
      <div className="mt-3 divide-y rounded-lg border">
        {siblings.map((p: any) => (
          <div key={p.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${p.id === currentId ? 'bg-gold/10' : ''}`}>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-navy">{p.name}{p.id === currentId && <span className="ml-2 text-[11px] font-bold text-gold">this one</span>}</p><p className="text-xs text-muted-foreground">{p.duration_days ? `${p.duration_days} Days / ${p.duration_nights ?? 0} Nights` : 'Duration not set'}{p.itinerary_pdf_file_name ? ` · ${p.itinerary_pdf_file_name}` : ''}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[status(p)] || STATUS_STYLE.NOT_SUBMITTED}`}>{STATUS_LABEL[status(p)] || status(p)}</span>
            {p.id !== currentId && <button type="button" onClick={() => router.push(`/packages/${p.id}`)} className="text-xs font-semibold text-navy underline">Open</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// An uploaded itinerary as you'd recognise it: the picture itself (image, or PDF page 1), the file
// An uploaded itinerary as you'd recognise it: the picture itself (image, or PDF page 1) marked
// with which itinerary it is, the file name underneath, and View / Replace file / Remove.
// "Replace file" swaps a wrongly chosen file and keeps that itinerary's Days and Nights.
function DocThumbCard({ thumb, fileName, label, busy, onView, onReplace, onRemove }: { thumb?: string; fileName: string; label?: string; busy?: boolean; onView: () => void; onReplace?: (e: React.ChangeEvent<HTMLInputElement>) => void; onRemove: () => void }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-gold/30 bg-gold/5">
      <div className="relative">
        <button type="button" onClick={onView} className="block w-full bg-white" title="Open full size">
          {thumb ? <img src={thumb} alt={fileName} className="max-h-56 w-full object-contain object-top" /> : <div className="grid h-28 place-items-center text-slate-400"><FileText className="h-10 w-10" /></div>}
        </button>
        {busy && <div className="absolute inset-0 grid place-items-center bg-white/70 text-xs font-semibold text-navy">Uploading…</div>}
      </div>
      <div className="flex items-center gap-2 border-t border-gold/20 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-navy" title={fileName}>{fileName}</span>
        <button type="button" onClick={onView} className="shrink-0 rounded p-1.5 text-navy hover:bg-gold/20" title="Open full size" aria-label="Open full size"><Eye className="h-4 w-4" /></button>
        {onReplace && <label className="shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-navy hover:border-gold" title="Choose a different file — Days and Nights stay as they are">Replace file<input type="file" hidden disabled={busy} onChange={onReplace} /></label>}
        <button type="button" onClick={onRemove} className="shrink-0 rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Remove this file (Days and Nights stay)" aria-label="Remove file"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
