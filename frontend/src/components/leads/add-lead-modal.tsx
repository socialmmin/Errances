'use client';

import { useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, UserRound, Phone as PhoneIcon, MessageCircle, Mail, Globe2,
  MapPin, CalendarDays, Users, Target, UserCheck2, NotebookPen, Sparkles, UserPlus, Minus, Plus,
  Wallet, ArrowRight, Circle, Heart, PartyPopper, Users2, Briefcase, GraduationCap, Mountain, HeartHandshake,
  Globe, Megaphone, Instagram, HandHeart, DoorOpen, Flag,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCreateLead, useAssignableUsers } from '@/hooks/use-leads';
import { LeadInput } from '@/types/lead';
import { useAuthStore } from '@/store/auth-store';
import { DESTINATIONS } from '@/lib/destinations';
import { PHONE_COUNTRIES, phoneWithCountry } from '@/lib/utils';
import { CountryCode } from '@/components/shared/country-code';

const TRAVEL_TYPES = [
  { value: 'Couple', icon: Heart, tone: 'bg-rose-100 text-rose-600' },
  { value: 'Honeymoon', icon: HeartHandshake, tone: 'bg-amber-100 text-amber-600' },
  { value: 'Family', icon: Users2, tone: 'bg-sky-100 text-sky-600' },
  { value: 'Bachelors', icon: PartyPopper, tone: 'bg-violet-100 text-violet-600' },
  { value: 'Corporate', icon: Briefcase, tone: 'bg-slate-200 text-slate-700' },
  { value: 'Students', icon: GraduationCap, tone: 'bg-indigo-100 text-indigo-600' },
  { value: 'Adventure', icon: Mountain, tone: 'bg-emerald-100 text-emerald-600' },
];
// Matches the backend's lead_source enum exactly (no Google Ads/Instagram/Facebook as separate
// values there -- Instagram/Facebook both fall under "Social Media" rather than inventing
// source values the database doesn't actually have).
const SOURCE_TILES = [
  { value: 'website', label: 'Website', icon: Globe, tone: 'bg-sky-100 text-sky-600' },
  { value: 'meta_ads', label: 'Meta Ads', icon: Megaphone, tone: 'bg-indigo-100 text-indigo-600' },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'bg-emerald-100 text-emerald-600' },
  { value: 'social_media', label: 'Social Media', icon: Instagram, tone: 'bg-pink-100 text-pink-600' },
  { value: 'referral', label: 'Referral', icon: HandHeart, tone: 'bg-amber-100 text-amber-600' },
  { value: 'walk_in', label: 'Walk-in', icon: DoorOpen, tone: 'bg-orange-100 text-orange-600' },
  { value: 'phone', label: 'Phone Call', icon: PhoneIcon, tone: 'bg-teal-100 text-teal-600' },
  { value: 'agent', label: 'Agent', icon: Briefcase, tone: 'bg-slate-200 text-slate-700' },
  { value: 'other', label: 'Other', icon: Flag, tone: 'bg-rose-100 text-rose-600' },
];
const PRIORITIES = [
  { value: 'dead', label: 'Dead', tone: 'border-slate-200 text-slate-500 data-[on=true]:bg-slate-200' },
  { value: 'cold', label: 'Cold', tone: 'border-sky-200 text-sky-600 data-[on=true]:bg-sky-100' },
  { value: 'hot', label: 'Hot', tone: 'border-amber-200 text-amber-600 data-[on=true]:bg-amber-100' },
  { value: 'strong', label: 'Strong', tone: 'border-rose-200 text-rose-600 data-[on=true]:bg-rose-100' },
];
const selectClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm transition focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20';
const inputClass = 'h-10 rounded-lg shadow-sm transition focus-visible:ring-2 focus-visible:ring-gold/20';

// Icon + label pair, used for every field -- an action-relevant icon (not an emoji) so each
// field reads at a glance instead of being a wall of identical plain labels.
function FieldLabel({ icon: Icon, children, required }: { icon: LucideIcon; children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
      <Icon className="h-3.5 w-3.5 text-gold" />
      {children}
      {required && <span className="text-red-500">*</span>}
    </Label>
  );
}


function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="flex h-10 items-center justify-between rounded-lg border border-input bg-background px-1.5 shadow-sm">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={value <= min} aria-label="Decrease"><Minus className="h-3.5 w-3.5" /></button>
      <span className="text-sm font-bold text-navy dark:text-white">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Increase"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// Type-ahead tag input for destination(s) -- prefix match ("CH" -> Chennai, "KE" -> Kerala),
// multiple destinations supported since one trip can cover several places.
function DestinationInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const matches = text.trim()
    ? DESTINATIONS.filter((d) => d.toLowerCase().startsWith(text.trim().toLowerCase()) && !value.includes(d)).slice(0, 8)
    : [];
  function add(place: string) {
    onChange([...value, place]);
    setText('');
    setOpen(false);
  }
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((d) => (
            <span key={d} className="flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-navy">
              {d}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== d))} aria-label={`Remove ${d}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
        <Input
          className={`${inputClass} pl-9`}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); add(text.trim()); } }}
          placeholder={value.length ? 'Add another destination…' : 'Where do they want to go?'}
        />
        {open && matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-input bg-background shadow-lg">
            {matches.map((m) => (
              <button key={m} type="button" onMouseDown={() => add(m)} className="block w-full px-3 py-2 text-left text-sm hover:bg-gold/10">{m}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AddLeadModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const createMutation = useCreateLead();
  const { data: assignable } = useAssignableUsers();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('33');
  const [whatsappSame, setWhatsappSame] = useState(true);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappCountry, setWhatsappCountry] = useState('33');
  const [email, setEmail] = useState('');
  const [nationality, setNationality] = useState('');
  const [destinations, setDestinations] = useState<string[]>([]);
  const [travelFrom, setTravelFrom] = useState('');
  const [travelTo, setTravelTo] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [budget, setBudget] = useState(0);
  const [travelType, setTravelType] = useState('');
  const [source, setSource] = useState('meta_ads');
  const [priority, setPriority] = useState('cold');
  // Defaults to whoever's creating this lead, per the request -- not left unassigned.
  const [assignedTo, setAssignedTo] = useState(currentUserId);
  const [remarks, setRemarks] = useState('');

  // Saved in full international form (+33612345678), whichever way it was typed.
  const fullPhone = phoneWithCountry(phoneCountry, phone);
  const fullWhatsapp = whatsappSame ? fullPhone : phoneWithCountry(whatsappCountry, whatsappNumber);
  function step1Valid() { return firstName.trim().length > 0 && lastName.trim().length > 0 && !!fullPhone && (whatsappSame || !whatsappNumber.trim() || !!fullWhatsapp); }
  function step2Valid() { return destinations.length > 0 && !!travelFrom && !!travelTo && adults > 0; }

  function resetForm() {
    setStep(1);
    setFirstName(''); setLastName(''); setPhone(''); setWhatsappSame(true); setWhatsappNumber('');
    setPhoneCountry('33'); setWhatsappCountry('33');
    setEmail(''); setNationality(''); setDestinations([]); setTravelFrom(''); setTravelTo('');
    setAdults(1); setChildren(0); setInfants(0); setBudget(0); setTravelType('');
    setSource('meta_ads'); setPriority('cold'); setAssignedTo(currentUserId); setRemarks('');
  }

  async function onSave(addAnother = false) {
    const payload: LeadInput = {
      customerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      phone: fullPhone || undefined,
      whatsappNumber: fullWhatsapp || fullPhone || undefined,
      email: email.trim() || undefined,
      nationality: nationality.trim() || undefined,
      destination: destinations.join(', '),
      travelFrom: travelFrom || undefined,
      travelTo: travelTo || undefined,
      adults,
      children,
      infants,
      budget: budget || undefined,
      travelType: travelType.trim() || undefined,
      source,
      priority,
      assignedTo: assignedTo || undefined,
      remarks: remarks.trim() || undefined,
      branchId,
    };
    try {
      await createMutation.mutateAsync(payload);
      toast('Lead created', 'success');
      if (addAnother) resetForm(); else onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to create lead', 'error');
    }
  }

  const steps = [
    { n: 1, label: 'Customer', icon: UserRound },
    { n: 2, label: 'Travel', icon: MapPin },
    { n: 3, label: 'Lead Info', icon: Target },
  ] as const;

  return (
    <div className="fixed inset-0 z-[500] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-12px_rgba(11,37,69,.45)] dark:bg-navy-900">
        <div className="relative overflow-hidden bg-gradient-to-br from-navy via-navy-900 to-slate-900 px-6 py-5">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gold/10 blur-2xl" />
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><Sparkles className="h-5 w-5" /></div>
              <div>
                <h2 className="text-lg font-bold text-white">Create New Lead</h2>
                <p className="text-xs text-white/70">Capture a new opportunity in 3 easy steps</p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-4 flex items-center">
            {steps.map((s, idx) => (
              <div key={s.n} className="flex flex-1 items-center">
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${s.n === step ? 'bg-white text-navy shadow-md' : s.n < step ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-white/50'}`}>
                  {s.n < step ? <Sparkles className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {idx < steps.length - 1 && <div className={`mx-1.5 h-px flex-1 ${s.n < step ? 'bg-emerald-400/50' : 'bg-white/15'}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><FieldLabel icon={UserRound} required>First Name</FieldLabel><Input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" /></div>
                <div className="space-y-1"><FieldLabel icon={UserRound} required>Last Name</FieldLabel><Input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FieldLabel icon={PhoneIcon} required>Phone</FieldLabel>
                  <div className="flex gap-2">
                    <CountryCode value={phoneCountry} onChange={setPhoneCountry} />
                    <Input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="one-time-code" placeholder={PHONE_COUNTRIES.find((c) => c.code === phoneCountry)?.example} />
                  </div>
                  {phone.trim() && !fullPhone && <p className="text-[11px] font-semibold text-red-600">Not a valid phone number</p>}
                </div>
                <div className="space-y-1"><FieldLabel icon={Mail}>Email</FieldLabel><Input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" /></div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={whatsappSame}
                onClick={() => setWhatsappSame((v) => !v)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-input bg-muted/30 px-3.5 py-2.5 text-left"
              >
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${whatsappSame ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${whatsappSame ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </span>
                <MessageCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="text-sm font-medium text-foreground">WhatsApp same as phone number</span>
              </button>
              {!whatsappSame && <div className="space-y-1"><FieldLabel icon={MessageCircle}>WhatsApp Number</FieldLabel><div className="flex gap-2"><CountryCode value={whatsappCountry} onChange={setWhatsappCountry} /><Input className={inputClass} value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} inputMode="tel" placeholder={PHONE_COUNTRIES.find((c) => c.code === whatsappCountry)?.example} /></div>{whatsappNumber.trim() && !fullWhatsapp && <p className="text-[11px] font-semibold text-red-600">Not a valid WhatsApp number</p>}</div>}
              <div className="space-y-1"><FieldLabel icon={Globe2}>Nationality</FieldLabel><Input className={inputClass} value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. French, Belgian, British" /></div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1"><FieldLabel icon={MapPin} required>Destination</FieldLabel><DestinationInput value={destinations} onChange={setDestinations} /></div>

              <div className="space-y-3 rounded-xl border border-dashed border-gold/30 bg-gold/5 p-3.5">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold"><CalendarDays className="h-4 w-4" /></div>
                  <div><p className="text-sm font-bold text-navy dark:text-white">Tour Schedule</p><p className="text-[11px] text-muted-foreground">Pick travel dates and group size</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 rounded-lg border border-input bg-white p-2.5 dark:bg-navy-800">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600"><ArrowRight className="h-3 w-3" />Check-in</p>
                    <input type="date" className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-navy outline-none dark:text-white" value={travelFrom} onChange={(e) => setTravelFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1 rounded-lg border border-input bg-white p-2.5 dark:bg-navy-800">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-sky-600"><Circle className="h-3 w-3" />Check-out</p>
                    <input type="date" className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-navy outline-none dark:text-white" value={travelTo} onChange={(e) => setTravelTo(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="space-y-1"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Adults <span className="text-red-500">*</span></p><Stepper value={adults} onChange={setAdults} min={1} /></div>
                  <div className="space-y-1"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Kids</p><Stepper value={children} onChange={setChildren} /></div>
                  <div className="space-y-1"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Infants</p><Stepper value={infants} onChange={setInfants} /></div>
                  <div className="space-y-1">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><Wallet className="h-3 w-3" />Budget</p>
                    <div className="flex h-10 items-center rounded-lg border border-input bg-background px-2 shadow-sm"><span className="text-xs text-muted-foreground">₹</span><input type="number" min={0} className="w-full border-0 bg-transparent p-0 pl-1 text-sm font-semibold text-navy outline-none dark:text-white" value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <FieldLabel icon={Briefcase}>Travel Type</FieldLabel>
                <div className="grid grid-cols-4 gap-2">
                  {TRAVEL_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => setTravelType(t.value === travelType ? '' : t.value)} className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-all ${travelType === t.value ? 'border-gold bg-gold/10 shadow-sm' : 'border-input hover:border-gold/50'}`}>
                      <div className={`grid h-8 w-8 place-items-center rounded-full ${t.tone}`}><t.icon className="h-4 w-4" /></div>
                      <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{t.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel icon={Target} required>Lead Source</FieldLabel>
                <div className="grid grid-cols-4 gap-2">
                  {SOURCE_TILES.map((s) => (
                    <button key={s.value} type="button" onClick={() => setSource(s.value)} className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-all ${source === s.value ? 'border-gold bg-gold/10 shadow-sm' : 'border-input hover:border-gold/50'}`}>
                      <div className={`grid h-7 w-7 place-items-center rounded-full ${s.tone}`}><s.icon className="h-3.5 w-3.5" /></div>
                      <span className="text-center text-[9.5px] font-semibold leading-tight text-slate-600 dark:text-slate-300">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <FieldLabel icon={Flag}>Priority</FieldLabel>
                <div className="flex gap-2">
                  {PRIORITIES.map((p) => (
                    <button key={p.value} type="button" data-on={priority === p.value} onClick={() => setPriority(p.value)} className={`flex-1 rounded-lg border px-2 py-2 text-xs font-bold transition-all ${p.tone} ${priority === p.value ? 'ring-1 ring-current' : 'opacity-60 hover:opacity-100'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <FieldLabel icon={UserCheck2}>Assign To</FieldLabel>
                <select className={selectClass} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  {!assignable?.data?.some((u) => u.id === currentUserId) && currentUserId && <option value={currentUserId}>Me</option>}
                  {(assignable?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.id === currentUserId ? `${u.full_name} (Me)` : u.full_name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel icon={NotebookPen}>Remarks</FieldLabel>
                <textarea rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any additional notes about this lead…" />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-slate-50/60 px-5 py-4 dark:bg-white/5">
          <Button type="button" variant="outline" onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2))} className="gap-1">
            {step === 1 ? 'Cancel' : <><ChevronLeft className="h-4 w-4" />Back</>}
          </Button>
          {step < 3 ? (
            <Button type="button" variant="gold" disabled={step === 1 ? !step1Valid() : !step2Valid()} onClick={() => setStep((s) => (s + 1) as 2 | 3)} className="gap-1 shadow-md shadow-gold/20">
              Next<ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={createMutation.isPending} onClick={() => onSave(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />Save &amp; Add Another
              </Button>
              <Button type="button" variant="gold" disabled={createMutation.isPending} onClick={() => onSave(false)} className="gap-1.5 shadow-md shadow-gold/20">
                <Sparkles className="h-4 w-4" />{createMutation.isPending ? 'Creating…' : 'Create Lead'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
