import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { LeadForm } from '@/components/leads/LeadForm';
import { StatusPipeline } from '@/components/leads/StatusPipeline';
import { FollowUpsPanel } from '@/components/leads/FollowUpsPanel';
import { DocumentsPanel } from '@/components/leads/DocumentsPanel';
import { PaymentsPanel } from '@/components/leads/PaymentsPanel';
import { ActivityTimeline } from '@/components/leads/ActivityTimeline';
import {
    ArrowLeft, Edit, Trash2, Mail, Phone, Hash, MessageSquare, Send, Smile, Paperclip,
    CheckCheck, Check, AlertTriangle, Users, Loader2, X, MapPin, Clock, User as UserIcon,
    Shield, Calendar, PhoneCall, CalendarPlus, StickyNote, UserCheck, ChevronDown, Sparkles,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n';
import { calculateAge, formatLeadNumber, PRIORITY_CONFIG, getStatusConfig, statusBadgeClass } from '@/lib/leadUtils';
import { LeadPhotoUpload } from '@/components/leads/LeadPhotoUpload';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Message = {
    id: string;
    content: string;
    sender: 'user' | 'contact';
    timestamp: Date;
    status: 'sent' | 'delivered' | 'read';
};

export function LeadDetails() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useI18n();

    const {
        leads, tours, staff, user, leadStatuses,
        fetchLeads, fetchTours, fetchStaff, fetchLeadStatuses, fetchFollowups,
        updateLead, deleteLead, sendWhatsApp, logLeadActivity,
    } = useAppStore();

    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageInput, setMessageInput] = useState('');
    const [isEmojiOpen, setIsEmojiOpen] = useState(false);
    const [isAttaching, setIsAttaching] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchLeads();
        fetchTours();
        fetchStaff();
        fetchLeadStatuses();
        fetchFollowups();
    }, [fetchLeads, fetchTours, fetchStaff, fetchLeadStatuses, fetchFollowups]);

    const lead = useMemo(() => leads.find(l => l.id === id), [leads, id]);

    const normalizePhone = (phone?: string) => {
        if (!phone) return '';
        const digits = phone.replace(/\D/g, '');
        return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    const leadIdsSharingPhone = useMemo(() => {
        if (!lead || !lead.phone) return lead ? [lead.id] : [];
        const targetPhone = normalizePhone(lead.phone);
        return leads.filter(l => l.phone && normalizePhone(l.phone) === targetPhone).map(l => l.id);
    }, [leads, lead]);

    useEffect(() => {
        if (leadIdsSharingPhone.length === 0) return;

        const fetchMessages = async () => {
            try {
                const { data, error } = await supabase
                    .from('whatsapp_messages')
                    .select('*')
                    .in('lead_id', leadIdsSharingPhone)
                    .order('created_at', { ascending: true });
                if (!error && data) {
                    setMessages(data.map((m: any) => ({
                        id: m.id, content: m.content, sender: m.sender, timestamp: new Date(m.created_at), status: m.status,
                    })));
                }
            } catch (err) {
                console.error('Failed to fetch messages:', err);
            }
        };
        fetchMessages();

        const channel = supabase
            .channel(`lead-details:${lead?.phone || lead?.id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
                const newMessage = payload.new;
                if (leadIdsSharingPhone.includes(newMessage.lead_id)) {
                    setMessages(prev => prev.some(m => m.id === newMessage.id) ? prev : [...prev, {
                        id: newMessage.id, content: newMessage.content, sender: newMessage.sender,
                        timestamp: new Date(newMessage.created_at), status: newMessage.status,
                    }]);
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [leadIdsSharingPhone, lead?.phone, lead?.id]);

    useEffect(() => {
        if (activeTab === 'communication') messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, activeTab]);

    const interestedTourDetails = useMemo(() => {
        if (!lead || !lead.tour_interest) return null;
        return tours.find(t => t.title.toLowerCase() === lead.tour_interest?.toLowerCase() || t.id === lead.tour_interest);
    }, [tours, lead]);

    const assignedStaffDetails = useMemo(() => lead?.assigned_staff_id ? staff.find(s => s.id === lead.assigned_staff_id) : null, [staff, lead]);

    const parsedNotes = useMemo(() => {
        let parsed = { notes: '', tour_departure: '', tour_arrival: '' };
        try {
            if (lead?.notes) {
                const obj = JSON.parse(lead.notes);
                if (obj && typeof obj === 'object') {
                    parsed = { notes: obj.notes || '', tour_departure: obj.tour_departure || '', tour_arrival: obj.tour_arrival || '' };
                }
            }
        } catch (_) {
            parsed.notes = lead?.notes || '';
        }
        return parsed;
    }, [lead?.notes]);

    if (!lead) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                <p className="text-slate-500 font-semibold">Loading lead details...</p>
            </div>
        );
    }

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !lead.phone) return;
        const currentMsg = messageInput;
        setMessageInput('');
        try {
            await sendWhatsApp(lead.id, lead.phone, currentMsg);
        } catch (error) {
            console.error("Failed to send WhatsApp message:", error);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !lead.phone) return;
        setIsAttaching(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async (event) => {
                const base64Data = event.target?.result as string;
                await sendWhatsApp(lead.id, lead.phone, base64Data);
                setIsAttaching(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            };
        } catch (err) {
            console.error('Failed to attach file:', err);
            toast.error('Failed to attach image');
            setIsAttaching(false);
        }
    };

    const handleStaffChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        await updateLead(lead.id, { assigned_staff_id: e.target.value || null });
    };

    const handleSaveLead = async (data: any) => {
        await updateLead(lead.id, data);
        setIsEditDialogOpen(false);
    };

    const handleDeleteLead = async () => {
        if (window.confirm('Are you sure you want to delete this lead?')) {
            await deleteLead(lead.id);
            navigate('/leads');
        }
    };

    const handleStatusChange = async (statusKey: string) => {
        await updateLead(lead.id, { status: statusKey });
    };

    const handleQuickCall = async () => {
        if (!lead.phone) return;
        window.location.href = `tel:${lead.phone}`;
        await updateLead(lead.id, { last_contacted_at: new Date().toISOString() });
        await logLeadActivity(lead.id, 'call', `Call logged by ${user?.full_name || 'staff'}`);
    };

    const handleQuickEmail = async () => {
        if (!lead.email) return;
        window.location.href = `mailto:${lead.email}`;
        await logLeadActivity(lead.id, 'email', `Email opened by ${user?.full_name || 'staff'}`);
    };

    const handleQuickSMS = async () => {
        if (!lead.phone) return;
        window.location.href = `sms:${lead.phone}`;
        await logLeadActivity(lead.id, 'call', `SMS opened by ${user?.full_name || 'staff'}`);
    };

    const handleConvert = async () => {
        const wonStatus = leadStatuses.find((s) => s.is_closed_won);
        if (!wonStatus) return;
        await updateLead(lead.id, { status: wonStatus.key });
        toast.success('Lead converted — all history, documents and payments are preserved.');
    };

    const statusCfg = getStatusConfig(leadStatuses, lead.status);
    const priorityCfg = PRIORITY_CONFIG[lead.priority || 'medium'];
    const age = calculateAge(lead.dob);

    const emojisList = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳'];

    return (
        <div className="min-h-[calc(100vh-6rem)] flex flex-col gap-6 animate-in fade-in duration-500 pb-8">
            {/* Header */}
            <div className="flex flex-col gap-5 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5 flex-none">
                <div className="flex items-start gap-4 flex-wrap justify-between">
                    <div className="flex items-start gap-4">
                        <Button variant="ghost" size="icon" className="bg-white/80 border border-slate-200/60 hover:bg-slate-50 h-10 w-10 rounded-xl flex-shrink-0" onClick={() => navigate('/leads')}>
                            <ArrowLeft className="h-5 w-5 text-slate-600" />
                        </Button>
                        <Avatar className="h-16 w-16 border-2 border-white shadow-md ring-1 ring-slate-100 flex-shrink-0">
                            <AvatarImage src={lead.photo_url || undefined} className="object-cover" />
                            <AvatarFallback className="bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 font-black uppercase">{lead.name.split(' ').map(n => n[0]).join('').substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <h2 className="text-2xl font-black tracking-tight text-slate-900 uppercase leading-none">{lead.name}</h2>
                                <Badge className={cn('border shadow-none font-black text-[10px] px-3 py-1 rounded-lg uppercase tracking-widest', statusBadgeClass(statusCfg.color))}>{statusCfg.label}</Badge>
                                <Badge className={cn('border shadow-none font-black text-[9px] px-2.5 py-1 rounded-lg uppercase tracking-widest', priorityCfg.className)}>{priorityCfg.label}</Badge>
                            </div>
                            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1.5">{formatLeadNumber(lead)} · Created {format(parseISO(lead.created_at), 'MMM d, yyyy')}</p>
                            <div className="flex items-center gap-4 mt-2 flex-wrap">
                                {lead.phone && <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><Phone className="h-3 w-3 opacity-50" />{lead.phone}</span>}
                                {lead.email && <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><Mail className="h-3 w-3 opacity-50" />{lead.email}</span>}
                                {assignedStaffDetails && <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-600"><UserCheck className="h-3 w-3" />{assignedStaffDetails.full_name}</span>}
                                <span className="text-xs font-bold text-slate-400">Source: {lead.source}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <Button variant="outline" className="bg-white border-slate-200 hover:bg-slate-50 font-bold rounded-xl h-11 px-5 flex items-center gap-2 text-slate-700" onClick={() => setIsEditDialogOpen(true)}>
                            <Edit className="h-4 w-4 text-indigo-600" /> {t('edit')}
                        </Button>
                        <Button variant="destructive" className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl h-11 px-5 flex items-center gap-2" onClick={handleDeleteLead}>
                            <Trash2 className="h-4 w-4" /> {t('delete')}
                        </Button>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2">
                    <QuickAction icon={PhoneCall} label="Call" onClick={handleQuickCall} disabled={!lead.phone} />
                    <QuickAction icon={MessageSquare} label="WhatsApp" onClick={() => setActiveTab('communication')} disabled={!lead.phone} />
                    <QuickAction icon={Mail} label="Email" onClick={handleQuickEmail} disabled={!lead.email} />
                    <QuickAction icon={StickyNote} label="SMS" onClick={handleQuickSMS} disabled={!lead.phone} />
                    <QuickAction icon={CalendarPlus} label="Add Follow-up" onClick={() => setActiveTab('followups')} />
                    <QuickAction icon={StickyNote} label="Add Note" onClick={() => setActiveTab('timeline')} />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-600 bg-white border border-slate-200 rounded-xl px-3.5 py-2 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                                <UserCheck className="h-3.5 w-3.5" /> Assign <ChevronDown className="h-3 w-3" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => updateLead(lead.id, { assigned_staff_id: null })}>Unassigned</DropdownMenuItem>
                            {staff.map((s) => <DropdownMenuItem key={s.id} onClick={() => updateLead(lead.id, { assigned_staff_id: s.id })}>{s.full_name}</DropdownMenuItem>)}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {!statusCfg.is_closed_won && (
                        <QuickAction icon={Check} label="Convert to Customer" onClick={handleConvert} accent />
                    )}
                </div>
            </div>

            <StatusPipeline value={lead.status} onChange={handleStatusChange} isAdmin={user?.role === 'admin'} />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
                <TabsList className="bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl p-1 flex-wrap h-auto">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="followups">Follow-ups</TabsTrigger>
                    <TabsTrigger value="communication">Communication</TabsTrigger>
                    <TabsTrigger value="documents">Documents</TabsTrigger>
                    <TabsTrigger value="payments">Payments</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 flex flex-col gap-6">
                            <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                                <CardHeader className="border-b border-slate-100/50 pb-4">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                        <Users className="h-4 w-4 text-indigo-500" /> Personal Information
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                                    <InfoField icon={Mail} color="indigo" label="Email Address" value={lead.email} />
                                    <InfoField icon={Phone} color="emerald" label="Phone Number" value={lead.phone} />
                                    <InfoField icon={MessageSquare} color="emerald" label="WhatsApp Number" value={lead.whatsapp_number || lead.phone} />
                                    <InfoField icon={Calendar} color="blue" label="Date of Birth" value={lead.dob ? `${format(new Date(lead.dob), 'MMM d, yyyy')}${age !== null ? ` (${age} yrs)` : ''}` : undefined} />
                                    <InfoField icon={UserIcon} color="amber" label="Gender" value={lead.gender} />
                                    <InfoField icon={Shield} color="indigo" label="Passport Number" value={lead.passport_number} />
                                    <InfoField icon={MapPin} color="rose" label="Address" value={[lead.address, lead.city, lead.state, lead.country, lead.pincode].filter(Boolean).join(', ')} />
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                                <CardHeader className="border-b border-slate-100/50 pb-4">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                        <Hash className="h-4 w-4 text-indigo-500" /> Lead Information
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                                    <InfoField icon={Clock} color="blue" label="Lead Source" value={lead.source} />
                                    <InfoField icon={Sparkles} color="indigo" label="Campaign" value={lead.campaign} />
                                    <InfoField icon={MapPin} color="emerald" label="Interested Service" value={lead.tour_interest} />
                                    <InfoField icon={Hash} color="amber" label="Budget" value={lead.budget ? `€${lead.budget.toLocaleString()}` : undefined} />
                                    <InfoField icon={Calendar} color="rose" label="Expected Closing" value={lead.expected_closing_date ? format(new Date(lead.expected_closing_date), 'MMM d, yyyy') : undefined} />
                                    <InfoField icon={UserCheck} color="indigo" label="Lead Owner" value={staff.find(s => s.id === lead.lead_owner_id)?.full_name} />
                                    <div className="md:col-span-2 pt-2">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Requirement / Notes</p>
                                        <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 font-medium text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">
                                            {lead.requirement || parsedNotes.notes || 'No notes added yet.'}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                                <CardHeader className="border-b border-slate-100/50 pb-4">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                        <MapPin className="h-4 w-4 text-emerald-500" /> Tour Package Interest
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    {interestedTourDetails ? (
                                        <div className="flex flex-col md:flex-row gap-5 items-center md:items-stretch">
                                            {interestedTourDetails.images?.[0] ? (
                                                <img src={interestedTourDetails.images[0]} alt={interestedTourDetails.title} className="w-full md:w-48 max-h-36 rounded-2xl object-cover border border-slate-200" />
                                            ) : (
                                                <div className="w-full md:w-48 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 min-h-[120px]">No Image</div>
                                            )}
                                            <div className="flex-1 flex flex-col justify-between py-1 text-center md:text-left">
                                                <div>
                                                    <h4 className="text-lg font-black text-slate-900 leading-snug">{interestedTourDetails.title}</h4>
                                                    <p className="text-slate-500 font-medium text-sm flex items-center gap-1.5 justify-center md:justify-start mt-1"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {interestedTourDetails.destination}</p>
                                                </div>
                                                <div className="flex justify-center md:justify-start items-center gap-5 mt-4">
                                                    <div><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Duration</p><p className="text-base font-bold text-slate-700">{interestedTourDetails.duration} Days</p></div>
                                                    <div className="w-px h-8 bg-slate-200" />
                                                    <div><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Price</p><p className="text-base font-black text-emerald-600">€{interestedTourDetails.price.toLocaleString()}</p></div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-slate-500 font-semibold text-center py-4">{lead.tour_interest ? `Interested in: "${lead.tour_interest}"` : 'No tour package interest specified yet.'}</p>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        <div className="flex flex-col gap-6">
                            <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
                                <CardHeader className="border-b border-slate-100/50 pb-4">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><UserIcon className="h-4 w-4 text-indigo-500" /> Photo</CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6 flex justify-center">
                                    <LeadPhotoUpload photoUrl={lead.photo_url} name={lead.name} onChange={(url) => updateLead(lead.id, { photo_url: url })} />
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
                                <CardHeader className="border-b border-slate-100/50 pb-4">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><UserIcon className="h-4 w-4 text-indigo-500" /> Assigned Staff Member</CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6 flex flex-col gap-5">
                                    {assignedStaffDetails ? (
                                        <div className="flex items-center gap-4 p-3 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                            <Avatar className="h-12 w-12 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                                <AvatarImage src={assignedStaffDetails.avatar_url} />
                                                <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-black text-sm uppercase">{assignedStaffDetails.full_name.split(' ').map(n => n[0]).join('').substring(0, 2)}</AvatarFallback>
                                            </Avatar>
                                            <div className="overflow-hidden">
                                                <h4 className="font-bold text-slate-900 text-sm truncate">{assignedStaffDetails.full_name}</h4>
                                                <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5">{assignedStaffDetails.role}</p>
                                                <p className="text-xs font-medium text-slate-400 truncate mt-1">{assignedStaffDetails.email}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-center text-slate-400 font-semibold text-sm">No staff member assigned</div>
                                    )}
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Reassign Lead</label>
                                        <select className="w-full bg-white border border-slate-200/80 rounded-xl h-11 px-3 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" value={lead.assigned_staff_id || ''} onChange={handleStaffChange}>
                                            <option value="">Select staff (unassigned)</option>
                                            {staff.map(member => <option key={member.id} value={member.id}>{member.full_name} ({member.role})</option>)}
                                        </select>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="followups" className="mt-4">
                    <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm p-6"><FollowUpsPanel leadId={lead.id} /></Card>
                </TabsContent>

                <TabsContent value="communication" className="mt-4">
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm flex flex-col h-[560px]">
                        <CardHeader className="border-b border-slate-100 pb-4 flex flex-row items-center justify-between flex-none">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><MessageSquare className="h-4 w-4 text-blue-500" /> WhatsApp Chat History</CardTitle>
                            {lead.phone && <span className="text-[10px] font-bold text-slate-400">{lead.phone}</span>}
                        </CardHeader>
                        <ScrollArea className="flex-1 p-5 bg-[#efeae2]/10 relative">
                            <div className="space-y-4 relative z-10">
                                {!lead.phone ? (
                                    <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 text-center px-4">
                                        <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
                                        <p className="text-sm font-semibold text-slate-700">No Phone Number Registered</p>
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 text-center px-4">
                                        <div className="h-12 w-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-3"><Send className="h-5 w-5 text-slate-400" /></div>
                                        <p className="text-sm font-semibold text-slate-700">No Messages Yet</p>
                                    </div>
                                ) : (
                                    messages.map((message) => {
                                        const isUser = message.sender === 'user';
                                        const isImage = message.content.startsWith('data:image/');
                                        return (
                                            <div key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                                                <div className={cn('max-w-[70%] rounded-lg px-4 py-2 shadow-sm', isUser ? 'bg-[#d9fdd3] text-slate-900 rounded-tr-none' : 'bg-white text-slate-900 rounded-tl-none')}>
                                                    {isImage ? (
                                                        <img src={message.content} alt="Attachment" className="max-h-56 max-w-full rounded-lg object-contain border border-slate-200 bg-slate-50" />
                                                    ) : (
                                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                                                    )}
                                                    <div className={cn('text-[9px] text-slate-400 mt-1 flex items-center gap-1 font-semibold', isUser ? 'justify-end' : 'justify-start')}>
                                                        {format(message.timestamp, 'h:mm a')}
                                                        {isUser && <span className={message.status === 'read' ? 'text-[#53bdeb]' : 'text-slate-400'}>{message.status === 'sent' ? <Check className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </ScrollArea>
                        {lead.phone && (
                            <div className="p-4 bg-white border-t border-slate-200 z-10 flex-none relative">
                                {isEmojiOpen && (
                                    <div className="absolute bottom-16 left-4 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-30 w-72 max-h-48 overflow-y-auto">
                                        <div className="flex justify-between items-center mb-2 pb-1 border-b border-slate-100">
                                            <span className="text-[10px] font-black uppercase text-slate-400">Select Emoji</span>
                                            <button onClick={() => setIsEmojiOpen(false)}><X className="h-3.5 w-3.5 text-slate-400" /></button>
                                        </div>
                                        <div className="grid grid-cols-8 gap-1.5 justify-items-center">
                                            {emojisList.map((emoji, idx) => <button key={idx} type="button" onClick={() => setMessageInput(p => p + emoji)} className="text-xl hover:scale-125 transition-transform">{emoji}</button>)}
                                        </div>
                                    </div>
                                )}
                                <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                                    <Button type="button" variant="ghost" size="icon" className={cn('text-slate-500 rounded-xl', isEmojiOpen && 'bg-slate-100')} onClick={() => setIsEmojiOpen(!isEmojiOpen)}><Smile className="h-6 w-6" /></Button>
                                    <Button type="button" variant="ghost" size="icon" className="text-slate-500 rounded-xl" onClick={() => fileInputRef.current?.click()} disabled={isAttaching}>
                                        {isAttaching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                                    </Button>
                                    <Input placeholder="Type a message" className="flex-1 bg-white border-slate-200 rounded-xl h-11" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} />
                                    <Button type="submit" size="icon" className={cn('h-11 w-11 rounded-xl shrink-0', messageInput.trim() ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-slate-100 text-slate-400')}><Send className="h-5 w-5" /></Button>
                                </form>
                            </div>
                        )}
                    </Card>
                </TabsContent>

                <TabsContent value="documents" className="mt-4">
                    <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm p-6"><DocumentsPanel leadId={lead.id} /></Card>
                </TabsContent>

                <TabsContent value="payments" className="mt-4">
                    <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm p-6"><PaymentsPanel leadId={lead.id} /></Card>
                </TabsContent>

                <TabsContent value="timeline" className="mt-4">
                    <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm p-6"><ActivityTimeline leadId={lead.id} /></Card>
                </TabsContent>
            </Tabs>

            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Edit Lead Details</DialogTitle>
                        <DialogDescription>Update the requirements and details of this lead.</DialogDescription>
                    </DialogHeader>
                    <LeadForm initialData={lead} onSubmit={handleSaveLead} onCancel={() => setIsEditDialogOpen(false)} />
                </DialogContent>
            </Dialog>
        </div>
    );
}

function QuickAction({ icon: Icon, label, onClick, disabled, accent }: { icon: any; label: string; onClick: () => void; disabled?: boolean; accent?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest rounded-xl px-3.5 py-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                accent ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
            )}
        >
            <Icon className="h-3.5 w-3.5" /> {label}
        </button>
    );
}

function InfoField({ icon: Icon, color, label, value }: { icon: any; color: string; label: string; value?: string | null }) {
    const colorClasses: Record<string, string> = {
        indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600', blue: 'bg-blue-50 text-blue-600', rose: 'bg-rose-50 text-rose-600',
    };
    return (
        <div className="flex items-center gap-3.5">
            <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0', colorClasses[color] || colorClasses.indigo)}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="overflow-hidden">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">{label}</p>
                <p className="text-sm font-bold text-slate-700 truncate mt-1 capitalize">{value || 'Not Specified'}</p>
            </div>
        </div>
    );
}
