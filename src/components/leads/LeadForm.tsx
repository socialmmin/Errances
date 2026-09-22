import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DialogFooter } from '@/components/ui/dialog';
import { DateOfBirthPicker } from '@/components/ui/DateOfBirthPicker';
import { LeadPhotoUpload } from '@/components/leads/LeadPhotoUpload';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { Lead } from '@/types';
import { useAppStore } from '@/store';
import { API_BASE, getAuthToken } from '@/lib/supabase';

const leadSchema = z.object({
    name: z.string().optional(),
    email: z.string().optional().refine(val => !val || val.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
        message: 'Invalid email address',
    }),
    phone: z.string().optional(),
    whatsapp_number: z.string().optional(),
    status: z.string().min(1, 'Status is required'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    source: z.string().min(1, 'Source is required'),
    campaign: z.string().optional(),
    tour_interest: z.string().optional(),
    requirement: z.string().optional(),
    budget: z.number().optional(),
    expected_closing_date: z.string().optional(),
    assigned_staff_id: z.string().optional(),
    lead_owner_id: z.string().optional(),
    dob: z.string().optional().nullable(),
    gender: z.string().optional(),
    passport_number: z.string().optional(),
    photo_url: z.string().optional().nullable(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    pincode: z.string().optional(),
    notes: z.string().optional(),
    tour_departure: z.string().optional(),
    tour_arrival: z.string().optional(),
}).superRefine((data, ctx) => {
    const hasName = Boolean(data.name && data.name.trim().length > 0);
    const hasEmail = Boolean(data.email && data.email.trim().length > 0);
    const hasPhone = Boolean(data.phone && data.phone.trim().length > 0);

    if (!hasName && !hasEmail && !hasPhone) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Please enter at least a Name, Email, or Phone number',
            path: ['name'],
        });
    }
});

type LeadFormValues = z.infer<typeof leadSchema>;

interface LeadFormProps {
    initialData?: Lead;
    onSubmit: (data: any) => void;
    onCancel: () => void;
    onViewExisting?: (leadId: string) => void;
    /** Prefills the Source field for fast lead entry (e.g. from the WhatsApp inbox or Quick Add). Ignored when editing. */
    presetSource?: string;
    /** Prefills phone + WhatsApp number, e.g. when creating a lead from an unmatched WhatsApp conversation. Ignored when editing. */
    presetPhone?: string;
    presetName?: string;
}

function parseLegacyNotes(notes?: string) {
    let parsed = { notes: '', tour_departure: '', tour_arrival: '', is_contact: undefined as any };
    try {
        if (notes) {
            const obj = JSON.parse(notes);
            if (obj && typeof obj === 'object') {
                parsed = {
                    notes: obj.notes || '',
                    tour_departure: obj.tour_departure || '',
                    tour_arrival: obj.tour_arrival || '',
                    is_contact: obj.is_contact,
                };
            }
        }
    } catch {
        parsed.notes = notes || '';
    }
    return parsed;
}

export function LeadForm({ initialData, onSubmit, onCancel, onViewExisting, presetSource, presetPhone, presetName }: LeadFormProps) {
    const { tours, staff, fetchStaff, leadStatuses, fetchLeadStatuses } = useAppStore();
    const [duplicate, setDuplicate] = useState<any>(null);
    const [checkingDuplicate, setCheckingDuplicate] = useState(false);

    useEffect(() => {
        if (staff.length === 0) fetchStaff();
        if (leadStatuses.length <= 1) fetchLeadStatuses();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const legacy = parseLegacyNotes(initialData?.notes);

    const form = useForm<LeadFormValues>({
        resolver: zodResolver(leadSchema) as any,
        defaultValues: initialData ? {
            name: initialData.name,
            email: initialData.email,
            phone: initialData.phone,
            whatsapp_number: initialData.whatsapp_number || '',
            status: initialData.status,
            priority: initialData.priority || 'medium',
            source: initialData.source,
            campaign: initialData.campaign || '',
            tour_interest: initialData.tour_interest || '',
            requirement: initialData.requirement || '',
            budget: initialData.budget,
            expected_closing_date: initialData.expected_closing_date || '',
            assigned_staff_id: initialData.assigned_staff_id || '',
            lead_owner_id: initialData.lead_owner_id || '',
            dob: initialData.dob || '',
            gender: initialData.gender || '',
            passport_number: initialData.passport_number || '',
            photo_url: initialData.photo_url || '',
            address: initialData.address || '',
            city: initialData.city || '',
            state: initialData.state || '',
            country: initialData.country || '',
            pincode: initialData.pincode || '',
            notes: legacy.notes,
            tour_departure: legacy.tour_departure || initialData.travel_date || '',
            tour_arrival: legacy.tour_arrival,
        } : {
            name: presetName || '', email: '', phone: presetPhone || '', whatsapp_number: presetPhone || '',
            status: 'new', priority: 'medium', source: presetSource || 'Website', campaign: '',
            tour_interest: '', requirement: '', budget: undefined, expected_closing_date: '',
            assigned_staff_id: '', lead_owner_id: '',
            dob: '', gender: '', passport_number: '', photo_url: '',
            address: '', city: '', state: '', country: '', pincode: '',
            notes: '', tour_departure: '', tour_arrival: '',
        },
    });

    const tourInterest = form.watch('tour_interest');
    const phone = form.watch('phone');
    const whatsapp = form.watch('whatsapp_number');
    const email = form.watch('email');

    useEffect(() => {
        if (tourInterest && tourInterest !== 'custom') {
            const selectedTour = tours.find(t => t.title === tourInterest);
            if (selectedTour) form.setValue('budget', selectedTour.price);
        } else if (tourInterest === 'custom') {
            form.setValue('budget', 0);
        }
    }, [tourInterest, tours, form]);

    // Duplicate detection (create mode only)
    useEffect(() => {
        if (initialData) return;
        const hasEnough = (phone && phone.trim().length >= 6) || (whatsapp && whatsapp.trim().length >= 6) || (email && email.includes('@'));
        if (!hasEnough) {
            setDuplicate(null);
            return;
        }
        const timeout = setTimeout(async () => {
            setCheckingDuplicate(true);
            try {
                const token = getAuthToken();
                const res = await fetch(`${API_BASE}/api/leads/check-duplicate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({ phone, whatsapp_number: whatsapp, email }),
                });
                const data = await res.json();
                setDuplicate(data.duplicate || null);
            } catch {
                // best-effort — don't block the form on a failed check
            } finally {
                setCheckingDuplicate(false);
            }
        }, 500);
        return () => clearTimeout(timeout);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phone, whatsapp, email, initialData]);

    const [forceCreate, setForceCreate] = useState(false);

    const handleSubmit = (values: LeadFormValues) => {
        if (duplicate && !forceCreate) return;

        let existingNotesObj: any = {};
        try {
            if (initialData?.notes) existingNotesObj = JSON.parse(initialData.notes);
        } catch { /* not JSON, ignore */ }
        if (typeof existingNotesObj !== 'object' || existingNotesObj === null) existingNotesObj = {};

        let finalName = (values.name || '').trim();
        const finalPhone = (values.phone || '').trim();
        const finalEmail = (values.email || '').trim();

        if (!finalName) {
            finalName = finalPhone || (finalEmail ? finalEmail.split('@')[0] : 'Unnamed Contact');
        }

        const payload: any = {
            ...values,
            name: finalName,
            email: finalEmail,
            phone: finalPhone,
            travel_date: values.tour_departure || null,
            notes: JSON.stringify({
                ...existingNotesObj,
                notes: values.notes || '',
                tour_departure: values.tour_departure || '',
                tour_arrival: values.tour_arrival || '',
            }),
        };
        for (const optional of ['assigned_staff_id', 'lead_owner_id']) {
            if (!payload[optional] || payload[optional] === 'unassigned' || payload[optional] === '') {
                payload[optional] = null;
            }
        }
        delete payload.tour_departure;
        delete payload.tour_arrival;

        onSubmit(payload);
    };

    const openStatuses = leadStatuses.filter((s) => !s.is_closed_won && !s.is_closed_lost);
    const closedStatuses = leadStatuses.filter((s) => s.is_closed_won || s.is_closed_lost);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                {duplicate && !forceCreate && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 text-amber-800 font-black text-xs uppercase tracking-wide">
                            <AlertTriangle className="h-4 w-4" /> Possible Duplicate Lead
                        </div>
                        <p className="text-xs text-amber-700 font-medium">
                            An existing lead <strong>{duplicate.name}</strong> already matches this phone/WhatsApp/email.
                        </p>
                        <div className="flex gap-2">
                            {onViewExisting && (
                                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onViewExisting(duplicate.id)}>
                                    <ExternalLink className="h-3 w-3 mr-1.5" /> View Existing Lead
                                </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setForceCreate(true)}>
                                Create Anyway
                            </Button>
                        </div>
                    </div>
                )}
                {checkingDuplicate && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Checking for duplicates…</p>}

                <div className="flex gap-5">
                    <FormField<LeadFormValues>
                        control={form.control}
                        name="photo_url"
                        render={({ field }) => (
                            <LeadPhotoUpload photoUrl={field.value as string | null} onChange={field.onChange} name={form.watch('name') || 'Lead'} />
                        )}
                    />
                    <div className="flex-1 grid grid-cols-2 gap-4">
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem className="col-span-2">
                                    <FormLabel>Full Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. John Doe (Optional if Email/Phone given)" {...field} value={field.value || ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input placeholder="john@example.com" type="email" {...field} value={field.value || ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Mobile Number</FormLabel>
                                    <FormControl>
                                        <Input placeholder="+1 234 567 890" {...field} value={field.value || ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField<LeadFormValues>
                        control={form.control}
                        name="whatsapp_number"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>WhatsApp Number</FormLabel>
                                <FormControl>
                                    <Input placeholder="Same as mobile if left blank" {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField<LeadFormValues>
                        control={form.control}
                        name="gender"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Gender</FormLabel>
                                <Select onValueChange={field.onChange} value={(field.value as string) || undefined}>
                                    <FormControl>
                                        <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="male">Male</SelectItem>
                                        <SelectItem value="female">Female</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField<LeadFormValues>
                    control={form.control}
                    name="dob"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Date of Birth</FormLabel>
                            <FormControl>
                                <DateOfBirthPicker value={field.value as string | null} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Address</h4>
                    <FormField<LeadFormValues>
                        control={form.control}
                        name="address"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <Input placeholder="Street address" {...field} value={field.value || ''} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <div className="grid grid-cols-4 gap-3 mt-3">
                        <FormField<LeadFormValues> control={form.control} name="city" render={({ field }) => (
                            <Input placeholder="City" {...field} value={field.value || ''} />
                        )} />
                        <FormField<LeadFormValues> control={form.control} name="state" render={({ field }) => (
                            <Input placeholder="State" {...field} value={field.value || ''} />
                        )} />
                        <FormField<LeadFormValues> control={form.control} name="country" render={({ field }) => (
                            <Input placeholder="Country" {...field} value={field.value || ''} />
                        )} />
                        <FormField<LeadFormValues> control={form.control} name="pincode" render={({ field }) => (
                            <Input placeholder="Pincode" {...field} value={field.value || ''} />
                        )} />
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Lead Information</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="status"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Status</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value as string}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {openStatuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                                            {closedStatuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="priority"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Priority</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value as string}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="low">Low</SelectItem>
                                            <SelectItem value="medium">Medium</SelectItem>
                                            <SelectItem value="high">High</SelectItem>
                                            <SelectItem value="urgent">Urgent</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="source"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Source</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="Website">Website</SelectItem>
                                            <SelectItem value="Referral">Referral</SelectItem>
                                            <SelectItem value="Walk-in">Walk-in</SelectItem>
                                            <SelectItem value="Social Media">Social Media</SelectItem>
                                            <SelectItem value="Exhibition">Exhibition</SelectItem>
                                            <SelectItem value="Other">Other</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="campaign"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Campaign</FormLabel>
                                    <FormControl><Input placeholder="e.g. Meta Ads - Sept" {...field} value={field.value || ''} /></FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="tour_interest"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Interested Service/Product</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select a tour (optional)" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="custom">Custom / Other</SelectItem>
                                            {tours.map((tour) => <SelectItem key={tour.id} value={tour.title}>{tour.title}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="budget"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Budget</FormLabel>
                                    <FormControl>
                                        <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="expected_closing_date"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Expected Closing Date</FormLabel>
                                    <FormControl><Input type="date" {...field} value={field.value || ''} /></FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="assigned_staff_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Assigned Employee</FormLabel>
                                    <Select onValueChange={field.onChange} value={(field.value as string) || 'unassigned'}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select staff (optional)" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="unassigned">Unassigned</SelectItem>
                                            {staff.map((member) => <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="lead_owner_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Lead Owner</FormLabel>
                                    <Select onValueChange={field.onChange} value={(field.value as string) || 'unassigned'}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Same as assigned (default)" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="unassigned">Same as assigned</SelectItem>
                                            {staff.map((member) => <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField<LeadFormValues>
                        control={form.control}
                        name="requirement"
                        render={({ field }) => (
                            <FormItem className="mt-4">
                                <FormLabel>Requirement</FormLabel>
                                <FormControl><Textarea placeholder="What is the customer looking for?" {...field} value={field.value || ''} rows={2} /></FormControl>
                            </FormItem>
                        )}
                    />
                </div>

                <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Travel & Passport Details</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="passport_number"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Passport Number</FormLabel>
                                    <FormControl><Input placeholder="Passport number" {...field} value={field.value || ''} /></FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="tour_departure"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Departure Date</FormLabel>
                                    <FormControl><Input type="date" {...field} value={field.value || ''} /></FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField<LeadFormValues>
                            control={form.control}
                            name="tour_arrival"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Arrival Date</FormLabel>
                                    <FormControl><Input type="date" {...field} value={field.value || ''} /></FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <FormField<LeadFormValues>
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Notes</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Additional details..." {...field} value={field.value || ''} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <DialogFooter className="pt-4 sticky bottom-0 bg-white">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={Boolean(duplicate) && !forceCreate}>Save Lead</Button>
                </DialogFooter>
            </form>
        </Form>
    );
}
