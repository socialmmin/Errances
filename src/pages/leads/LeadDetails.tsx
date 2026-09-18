import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { LeadForm } from '@/components/leads/LeadForm';
import {
    ArrowLeft,
    Edit,
    Trash2,
    Mail,
    Phone,
    Hash,
    MessageSquare,
    Send,
    Smile,
    Paperclip,
    CheckCheck,
    Check,
    AlertTriangle,
    Users,
    Loader2,
    X,
    MapPin,
    Clock,
    User,
    Shield,
    Calendar,
    Plane
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n';

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
        leads,
        tours,
        staff,
        fetchLeads,
        fetchTours,
        fetchStaff,
        updateLead,
        deleteLead,
        sendWhatsApp
    } = useAppStore();

    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageInput, setMessageInput] = useState('');
    const [isEmojiOpen, setIsEmojiOpen] = useState(false);
    const [isAttaching, setIsAttaching] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initial load
    useEffect(() => {
        fetchLeads();
        fetchTours();
        fetchStaff();
    }, [fetchLeads, fetchTours, fetchStaff]);

    // Find current lead
    const lead = useMemo(() => {
        return leads.find(l => l.id === id);
    }, [leads, id]);

    // Normalize phone helper
    const normalizePhone = (phone?: string) => {
        if (!phone) return '';
        const digits = phone.replace(/\D/g, '');
        return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    // Find all lead IDs sharing the same phone number for message consolidation
    const leadIdsSharingPhone = useMemo(() => {
        if (!lead || !lead.phone) return lead ? [lead.id] : [];
        const targetPhone = normalizePhone(lead.phone);
        return leads
            .filter(l => l.phone && normalizePhone(l.phone) === targetPhone)
            .map(l => l.id);
    }, [leads, lead]);

    // Fetch messages and subscribe to real-time changes
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
                        id: m.id,
                        content: m.content,
                        sender: m.sender as 'user' | 'contact',
                        timestamp: new Date(m.created_at),
                        status: m.status as 'sent' | 'delivered' | 'read'
                    })));
                }
            } catch (err) {
                console.error('Failed to fetch messages:', err);
            }
        };

        fetchMessages();

        const channel = supabase
            .channel(`lead-details:${lead?.phone || lead?.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'whatsapp_messages'
                },
                (payload) => {
                    const newMessage = payload.new;
                    if (leadIdsSharingPhone.includes(newMessage.lead_id)) {
                        setMessages(prev => {
                            if (prev.some(m => m.id === newMessage.id)) return prev;
                            return [...prev, {
                                id: newMessage.id,
                                content: newMessage.content,
                                sender: newMessage.sender as 'user' | 'contact',
                                timestamp: new Date(newMessage.created_at),
                                status: newMessage.status as 'sent' | 'delivered' | 'read'
                            }];
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [leadIdsSharingPhone, lead?.phone, lead?.id]);

    // Auto-scroll messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Resolve tour details
    const interestedTourDetails = useMemo(() => {
        if (!lead || !lead.tour_interest) return null;
        return tours.find(t => 
            t.title.toLowerCase() === lead.tour_interest?.toLowerCase() ||
            t.id === lead.tour_interest
        );
    }, [tours, lead]);

    // Resolve assigned staff details
    const assignedStaffDetails = useMemo(() => {
        if (!lead || !lead.assigned_staff_id) return null;
        return staff.find(s => s.id === lead.assigned_staff_id);
    }, [staff, lead]);

    const parsedNotes = useMemo(() => {
        let parsed = {
            notes: '',
            passport_details: '',
            dob: '',
            tour_departure: '',
            tour_arrival: ''
        };
        try {
            if (lead?.notes) {
                const obj = JSON.parse(lead.notes);
                if (obj && typeof obj === 'object') {
                    parsed = {
                        notes: obj.notes || '',
                        passport_details: obj.passport_details || '',
                        dob: obj.dob || '',
                        tour_departure: obj.tour_departure || '',
                        tour_arrival: obj.tour_arrival || '',
                    };
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

    const handleEmojiClick = (emoji: string) => {
        setMessageInput(prev => prev + emoji);
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
        const newStaffId = e.target.value ? e.target.value : null;
        try {
            await updateLead(lead.id, { assigned_staff_id: newStaffId });
            toast.success('Assigned staff updated successfully');
        } catch (err) {
            console.error('Failed to update assigned staff:', err);
        }
    };

    const handleSaveLead = async (data: any) => {
        try {
            await updateLead(lead.id, data);
            setIsEditDialogOpen(false);
        } catch (err) {
            console.error('Failed to save lead edits:', err);
        }
    };

    const handleDeleteLead = async () => {
        if (window.confirm('Are you sure you want to delete this lead?')) {
            try {
                await deleteLead(lead.id);
                navigate('/leads');
            } catch (err) {
                console.error('Failed to delete lead:', err);
            }
        }
    };

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'new': return 'bg-rose-50 text-rose-700 border-rose-100';
            case 'contacted': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'qualified': return 'bg-amber-50 text-amber-700 border-amber-100';
            case 'proposal_sent': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
            case 'converted': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
            case 'lost': return 'bg-slate-50 text-slate-500 border-slate-100';
            default: return 'bg-slate-50 text-slate-700 border-slate-100';
        }
    };

    const formatStatus = (status: string) => {
        return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    // Stages list for progress tracker
    const stages = ['new', 'contacted', 'qualified', 'proposal_sent', 'converted'];
    const currentStageIndex = stages.indexOf(lead.status === 'lost' ? 'new' : lead.status);

    const emojisList = [
        '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
    ];

    return (
        <div className="min-h-[calc(100vh-6rem)] flex flex-col gap-6 animate-in fade-in duration-500 pb-8">
            {/* Header / Back Action */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5 flex-none">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="bg-white/80 backdrop-blur-sm border border-slate-200/60 hover:bg-slate-50 h-10 w-10 rounded-xl"
                        onClick={() => navigate('/leads')}
                    >
                        <ArrowLeft className="h-5 w-5 text-slate-600" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="text-2xl font-black tracking-tight text-slate-900 uppercase leading-none">{lead.name}</h2>
                            <Badge className={cn("border shadow-none font-black text-[10px] px-3 py-1 rounded-lg uppercase tracking-widest leading-none mt-0.5", getStatusStyles(lead.status))}>
                                {formatStatus(lead.status)}
                            </Badge>
                        </div>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
                            Lead Created: {format(parseISO(lead.created_at), 'MMM d, yyyy h:mm a')}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
                    <Button
                        variant="outline"
                        className="bg-white border-slate-200 hover:bg-slate-50 font-bold rounded-xl h-11 px-5 flex items-center gap-2 text-slate-700"
                        onClick={() => setIsEditDialogOpen(true)}
                    >
                        <Edit className="h-4 w-4 text-indigo-600" /> {t('edit')}
                    </Button>
                    <Button
                        variant="destructive"
                        className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl h-11 px-5 flex items-center gap-2"
                        onClick={handleDeleteLead}
                    >
                        <Trash2 className="h-4 w-4" /> {t('delete')}
                    </Button>
                </div>
            </div>

            {/* Stages Progress Tracker */}
            {lead.status !== 'lost' && (
                <div className="bg-white/60 backdrop-blur-sm p-6 rounded-3xl border border-white/80 shadow-sm shadow-indigo-900/5 flex flex-col gap-4">
                    <div className="flex justify-between items-center px-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sales Progress Stage</span>
                        <span className="text-xs font-black text-indigo-600 uppercase tracking-wider">{formatStatus(lead.status)}</span>
                    </div>
                    <div className="relative flex items-center justify-between w-full mt-2">
                        {/* Connecting Progress Line */}
                        <div className="absolute left-0 right-0 h-1 bg-slate-200 z-0 rounded" />
                        <div 
                            className="absolute left-0 h-1 bg-gradient-to-r from-emerald-400 to-indigo-500 z-0 rounded transition-all duration-500" 
                            style={{ width: `${(currentStageIndex / (stages.length - 1)) * 100}%` }}
                        />

                        {/* Stages Nodes */}
                        {stages.map((stage, idx) => {
                            const isActive = idx <= currentStageIndex;
                            const isCurrent = idx === currentStageIndex;
                            return (
                                <div key={stage} className="flex flex-col items-center z-10">
                                    <div className={cn(
                                        "h-7 w-7 rounded-full flex items-center justify-center transition-all duration-300 font-bold text-xs shadow-md border-2",
                                        isCurrent ? "bg-indigo-600 border-white text-white scale-125 ring-4 ring-indigo-100" :
                                        isActive ? "bg-emerald-500 border-white text-white" :
                                        "bg-white border-slate-200 text-slate-400"
                                    )}>
                                        {isActive ? "✓" : idx + 1}
                                    </div>
                                    <span className={cn(
                                        "text-[9px] font-black uppercase tracking-widest mt-2 hidden sm:block",
                                        isActive ? "text-slate-800" : "text-slate-400"
                                    )}>
                                        {stage.replace('_', ' ')}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Grid Layout Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
                {/* Left Side: Overview & Tours */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    {/* Lead Overview Card */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                        <CardHeader className="border-b border-slate-100/50 pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <Users className="h-4 w-4 text-indigo-500" />
                                Lead Information Overview
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
                                    <Mail className="h-4 w-4" />
                                </div>
                                <div className="overflow-hidden">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Email Address</p>
                                    <p className="text-sm font-bold text-slate-700 truncate mt-1">{lead.email}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                                    <Phone className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Phone Number</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1">{lead.phone || 'Not Specified'}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 flex-shrink-0">
                                    <Hash className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Budget Amount</p>
                                    <p className="text-sm font-black text-emerald-600 mt-1">
                                        {lead.budget ? `€${lead.budget.toLocaleString()}` : 'Not Specified'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 flex-shrink-0">
                                    <Clock className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Lead Source</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1">{lead.source}</p>
                                </div>
                            </div>

                            <div className="md:col-span-2 pt-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Lead Notes & Requirements</p>
                                <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 font-medium text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">
                                    {parsedNotes.notes || 'No notes added yet. Click edit to add details.'}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Client & Travel Details Card */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                        <CardHeader className="border-b border-slate-100/50 pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <Plane className="h-4 w-4 text-indigo-500" />
                                Client & Travel Details
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
                                    <Shield className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Passport Details</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1">{parsedNotes.passport_details || 'Not Specified'}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                                    <Calendar className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Date of Birth</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1">
                                        {parsedNotes.dob ? (() => {
                                            try {
                                                return format(parseISO(parsedNotes.dob), 'MMM d, yyyy');
                                            } catch (_) {
                                                return parsedNotes.dob;
                                            }
                                        })() : 'Not Specified'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 flex-shrink-0">
                                    <Plane className="h-4 w-4 rotate-45" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Departure Date</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1">
                                        {parsedNotes.tour_departure ? (() => {
                                            try {
                                                return format(parseISO(parsedNotes.tour_departure), 'MMM d, yyyy');
                                            } catch (_) {
                                                return parsedNotes.tour_departure;
                                            }
                                        })() : 'Not Specified'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3.5">
                                <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 flex-shrink-0">
                                    <Plane className="h-4 w-4 -rotate-45" />
                                </div>
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Arrival Date</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1">
                                        {parsedNotes.tour_arrival ? (() => {
                                            try {
                                                return format(parseISO(parsedNotes.tour_arrival), 'MMM d, yyyy');
                                            } catch (_) {
                                                return parsedNotes.tour_arrival;
                                            }
                                        })() : 'Not Specified'}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Interested Tour Package Card */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                        <CardHeader className="border-b border-slate-100/50 pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-emerald-500" />
                                Tour Package Interest
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {interestedTourDetails ? (
                                <div className="flex flex-col md:flex-row gap-5 items-center md:items-stretch">
                                    {interestedTourDetails.images && interestedTourDetails.images[0] ? (
                                        <img 
                                            src={interestedTourDetails.images[0]} 
                                            alt={interestedTourDetails.title}
                                            className="w-full md:w-48 max-h-36 rounded-2xl object-cover border border-slate-200" 
                                        />
                                    ) : (
                                        <div className="w-full md:w-48 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 min-h-[120px]">
                                            No Image
                                        </div>
                                    )}
                                    <div className="flex-1 flex flex-col justify-between py-1 text-center md:text-left">
                                        <div>
                                            <div className="flex justify-center md:justify-start items-center gap-2.5 flex-wrap">
                                                <h4 className="text-lg font-black text-slate-900 leading-snug">{interestedTourDetails.title}</h4>
                                                <Badge className="bg-emerald-50 border border-emerald-100 text-emerald-700 shadow-none font-black text-[8px] uppercase tracking-widest">
                                                    Active Package
                                                </Badge>
                                            </div>
                                            <p className="text-slate-500 font-medium text-sm flex items-center gap-1.5 justify-center md:justify-start mt-1">
                                                <MapPin className="h-3.5 w-3.5 text-slate-400" /> {interestedTourDetails.destination}
                                            </p>
                                        </div>
                                        <div className="flex justify-center md:justify-start items-center gap-5 mt-4">
                                            <div>
                                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Duration</p>
                                                <p className="text-base font-bold text-slate-700">{interestedTourDetails.duration} Days</p>
                                            </div>
                                            <div className="w-px h-8 bg-slate-200" />
                                            <div>
                                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Price Package</p>
                                                <p className="text-base font-black text-emerald-600">€{interestedTourDetails.price.toLocaleString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-6">
                                    <p className="text-slate-500 font-semibold">{lead.tour_interest ? `Interested in customized/unknown package: "${lead.tour_interest}"` : 'No tour package interest specified yet.'}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* WhatsApp Messages Chat Window */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm flex flex-col h-[500px]">
                        <CardHeader className="border-b border-slate-100 pb-4 flex flex-row items-center justify-between flex-none">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-blue-500" />
                                WhatsApp Chat History
                            </CardTitle>
                            {lead.phone && (
                                <span className="text-[10px] font-bold text-slate-400">{lead.phone}</span>
                            )}
                        </CardHeader>
                        
                        {/* Messages Area */}
                        <ScrollArea className="flex-1 p-5 bg-[#efeae2]/10 relative">
                            <div className="absolute inset-0 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] opacity-[0.02] pointer-events-none" />
                            <div className="space-y-4 relative z-10">
                                {!lead.phone ? (
                                    <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 text-center px-4">
                                        <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
                                        <p className="text-sm font-semibold text-slate-700">No Phone Number Registered</p>
                                        <p className="text-xs text-slate-400 mt-1 max-w-[280px]">Add a phone number to this lead to view or send WhatsApp messages.</p>
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 text-center px-4">
                                        <div className="h-12 w-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                                            <Send className="h-5 w-5 text-slate-400" />
                                        </div>
                                        <p className="text-sm font-semibold text-slate-700">No Messages Yet</p>
                                        <p className="text-xs text-slate-400 mt-1">Start chatting with this lead using the input below.</p>
                                    </div>
                                ) : (
                                    messages.map((message) => {
                                        const isUser = message.sender === 'user';
                                        const isImage = message.content.startsWith('data:image/');
                                        return (
                                            <div
                                                key={message.id}
                                                className={cn(
                                                    "flex",
                                                    isUser ? "justify-end" : "justify-start"
                                                )}
                                            >
                                                <div
                                                    className={cn(
                                                        "max-w-[70%] rounded-lg px-4 py-2 shadow-sm relative group transition-all duration-300",
                                                        isUser
                                                            ? "bg-[#d9fdd3] text-slate-900 rounded-tr-none"
                                                            : "bg-white text-slate-900 rounded-tl-none"
                                                    )}
                                                >
                                                    {isImage ? (
                                                        <div className="my-1">
                                                            <img
                                                                src={message.content}
                                                                alt="Attachment"
                                                                className="max-h-56 max-w-full rounded-lg object-contain border border-slate-200 bg-slate-50 cursor-pointer hover:opacity-95"
                                                                onClick={() => {
                                                                    const w = window.open();
                                                                    w?.document.write(`<img src="${message.content}" style="max-width:100%; max-height:100%; display:block; margin:auto;" />`);
                                                                }}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                                                    )}
                                                    <div className={cn("text-[9px] text-slate-400 mt-1 flex items-center gap-1 font-semibold", isUser ? "justify-end" : "justify-start")}>
                                                        {format(message.timestamp, 'h:mm a')}
                                                        {isUser && (
                                                            <span className={cn(
                                                                message.status === 'read' ? "text-[#53bdeb]" : "text-slate-400"
                                                            )}>
                                                                {message.status === 'sent' ? (
                                                                    <Check className="h-3.5 w-3.5" />
                                                                ) : (
                                                                    <CheckCheck className="h-3.5 w-3.5" />
                                                                )}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </ScrollArea>

                        {/* Message Composer */}
                        {lead.phone && (
                            <div className="p-4 bg-white border-t border-slate-200 z-10 flex-none relative">
                                {/* Emoji popover */}
                                {isEmojiOpen && (
                                    <div className="absolute bottom-16 left-4 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-30 w-72 max-h-48 overflow-y-auto">
                                        <div className="flex justify-between items-center mb-2 pb-1 border-b border-slate-100">
                                            <span className="text-[10px] font-black uppercase text-slate-400">Select Emoji</span>
                                            <button onClick={() => setIsEmojiOpen(false)} className="text-slate-400 hover:text-slate-600">
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-8 gap-1.5 justify-items-center">
                                            {emojisList.map((emoji, idx) => (
                                                <button
                                                    key={idx}
                                                    type="button"
                                                    onClick={() => handleEmojiClick(emoji)}
                                                    className="text-xl hover:scale-125 transition-transform p-0.5"
                                                >
                                                    {emoji}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                />

                                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className={cn("text-slate-500 rounded-xl hover:bg-slate-50", isEmojiOpen && "bg-slate-100 text-slate-800")}
                                        onClick={() => setIsEmojiOpen(!isEmojiOpen)}
                                    >
                                        <Smile className="h-6 w-6" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className={cn("text-slate-500 rounded-xl hover:bg-slate-50", isAttaching && "animate-pulse text-indigo-600")}
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isAttaching}
                                    >
                                        {isAttaching ? (
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                        ) : (
                                            <Paperclip className="h-5 w-5" />
                                        )}
                                    </Button>
                                    <Input
                                        placeholder="Type a message"
                                        className="flex-1 bg-white border-slate-200 focus-visible:ring-0 focus-visible:border-slate-300 font-medium rounded-xl h-11"
                                        value={messageInput}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessageInput(e.target.value)}
                                    />
                                    <Button
                                        type="submit"
                                        size="icon"
                                        className={cn(
                                            "transition-all h-11 w-11 rounded-xl shrink-0",
                                            messageInput.trim() ? "bg-green-600 hover:bg-green-700 text-white shadow-md" : "bg-slate-100 text-slate-400"
                                        )}
                                    >
                                        <Send className="h-5 w-5" />
                                    </Button>
                                </form>
                            </div>
                        )}
                    </Card>
                </div>

                {/* Right Side: Assigned Staff */}
                <div className="flex flex-col gap-6">
                    <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
                        <CardHeader className="border-b border-slate-100/50 pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <User className="h-4 w-4 text-indigo-500" />
                                Assigned Staff Member
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6 flex flex-col gap-5">
                            {assignedStaffDetails ? (
                                <div className="flex items-center gap-4 p-3 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                    <Avatar className="h-12 w-12 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                        <AvatarImage src={assignedStaffDetails.avatar_url} />
                                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-black text-sm uppercase">
                                            {assignedStaffDetails.full_name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="overflow-hidden">
                                        <h4 className="font-bold text-slate-900 text-sm truncate">{assignedStaffDetails.full_name}</h4>
                                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5">{assignedStaffDetails.role}</p>
                                        <p className="text-xs font-medium text-slate-400 truncate mt-1">{assignedStaffDetails.email}</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-center text-slate-400 font-semibold text-sm">
                                    No staff member assigned
                                </div>
                            )}

                            {/* Reassignment Dropdown */}
                            <div className="flex flex-col gap-2">
                                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Reassign Lead</label>
                                <select
                                    className="w-full bg-white border border-slate-200/80 rounded-xl h-11 px-3 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                    value={lead.assigned_staff_id || ''}
                                    onChange={handleStaffChange}
                                >
                                    <option value="">Select staff (unassigned)</option>
                                    {staff.map(member => (
                                        <option key={member.id} value={member.id}>
                                            {member.full_name} ({member.role})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Edit Lead Modal Integration */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Lead Details</DialogTitle>
                        <DialogDescription>
                            Update the requirements and details of this lead.
                        </DialogDescription>
                    </DialogHeader>
                    <LeadForm
                        initialData={lead}
                        onSubmit={handleSaveLead}
                        onCancel={() => setIsEditDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
