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
import { StaffForm } from '@/components/staff/StaffForm';
import {
    ArrowLeft,
    Edit,
    Trash2,
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
    User,
    TrendingUp,
    CheckCircle2,
    Euro
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n';
import { getLeadRevenue } from '@/lib/utils';
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip
} from 'recharts';

type Message = {
    id: string;
    content: string;
    sender: 'user' | 'contact';
    timestamp: Date;
    status: 'sent' | 'delivered' | 'read';
};

export function StaffDetails() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useI18n();

    const {
        staff,
        leads,
        tours,
        fetchStaff,
        fetchLeads,
        fetchTours,
        updateStaff,
        deleteStaff,
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
        fetchStaff();
        fetchLeads();
        fetchTours();
    }, [fetchStaff, fetchLeads, fetchTours]);

    // Find current staff member
    const member = useMemo(() => {
        return staff.find(s => s.id === id);
    }, [staff, id]);

    // Ensure matching dummy lead exists for this staff in database so WhatsApp logs can reference it
    useEffect(() => {
        if (!member) return;
        
        const checkAndCreateDummyLead = async () => {
            const exists = leads.some(l => l.id === member.id);
            if (!exists) {
                console.log('StaffDetails: Creating dummy lead for staff', member.id);
                try {
                    const newLead = {
                        id: member.id,
                        name: member.full_name,
                        email: member.email,
                        phone: member.phone || '',
                        status: 'converted' as const,
                        source: 'Staff',
                        created_at: new Date().toISOString()
                    };
                    await supabase.from('leads').insert([newLead]);
                    await fetchLeads();
                } catch (err) {
                    console.error('Failed to create dummy lead for staff:', err);
                }
            } else {
                // Keep dummy lead in sync if name, email, or phone changed
                const dummy = leads.find(l => l.id === member.id);
                if (dummy && (dummy.phone !== (member.phone || '') || dummy.name !== member.full_name || dummy.email !== member.email)) {
                    console.log('StaffDetails: Updating dummy lead for staff', member.id);
                    try {
                        await supabase.from('leads').update({
                            name: member.full_name,
                            email: member.email,
                            phone: member.phone || ''
                        }).eq('id', member.id);
                        await fetchLeads();
                    } catch (err) {
                        console.error('Failed to update dummy lead for staff:', err);
                    }
                }
            }
        };
        checkAndCreateDummyLead();
    }, [member, leads, fetchLeads]);

    // Fetch messages and subscribe to real-time changes
    useEffect(() => {
        if (!member) return;

        const fetchMessages = async () => {
            try {
                const { data, error } = await supabase
                    .from('whatsapp_messages')
                    .select('*')
                    .eq('lead_id', member.id)
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
                console.error('Failed to fetch messages for staff:', err);
            }
        };

        fetchMessages();

        const channel = supabase
            .channel(`staff-details:${member.phone || member.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'whatsapp_messages'
                },
                (payload) => {
                    const newMessage = payload.new;
                    if (newMessage.lead_id === member.id) {
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
    }, [member?.id, member?.phone]);

    // Auto-scroll messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !member?.phone) return;

        const currentMsg = messageInput;
        setMessageInput('');

        try {
            await sendWhatsApp(member.id, member.phone, currentMsg);
        } catch (error) {
            console.error("Failed to send WhatsApp message:", error);
        }
    };

    const handleEmojiClick = (emoji: string) => {
        setMessageInput(prev => prev + emoji);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !member?.phone) return;

        const staffId = member.id;
        const staffPhone = member.phone;

        setIsAttaching(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async (event) => {
                const base64Data = event.target?.result as string;
                await sendWhatsApp(staffId, staffPhone, base64Data);
                setIsAttaching(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            };
        } catch (err) {
            console.error('Failed to attach file:', err);
            toast.error('Failed to attach image');
            setIsAttaching(false);
        }
    };

    const handleSaveStaff = async (data: any) => {
        if (!member) return;
        try {
            await updateStaff(member.id, {
                full_name: data.full_name,
                email: data.email,
                role: data.role,
                phone: data.phone,
            });
            setIsEditDialogOpen(false);
        } catch (err) {
            console.error('Failed to save staff:', err);
        }
    };

    const handleDeleteStaff = async () => {
        if (!member) return;
        if (window.confirm('Are you sure you want to delete this staff member?')) {
            try {
                await deleteStaff(member.id);
                navigate('/staff');
            } catch (err) {
                console.error('Failed to delete staff member:', err);
            }
        }
    };

    const stats = useMemo(() => {
        if (!member) return { dealsClosed: 0, totalRevenue: 0, conversion: 0, totalLeads: 0, staffLeads: [] };

        const filteredLeads = leads.filter(l => 
            l.source !== 'Staff' && 
            l.source !== 'WhatsApp' && 
            l.source !== 'WhatsApp Sync' && 
            l.source !== 'WhatsApp Web' && 
            l.source !== 'WhatsApp Group'
        );
        const staffLeads = filteredLeads.filter(l => l.assigned_staff_id === member.id);
        const totalLeads = staffLeads.length;
        const convertedLeads = staffLeads.filter(l => l.status === 'converted');

        const dealsClosed = convertedLeads.length;
        const totalRevenue = convertedLeads.reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);
        const conversion = totalLeads > 0 ? Math.round((dealsClosed / totalLeads) * 100) : 0;

        return { dealsClosed, totalRevenue, conversion, totalLeads, staffLeads };
    }, [member, leads]);

    const statusData = useMemo(() => {
        const counts: Record<string, number> = {};
        stats.staffLeads.forEach(l => {
            counts[l.status] = (counts[l.status] || 0) + 1;
        });
        return [
            { name: 'New', value: counts['new'] || 0 },
            { name: 'Contacted', value: counts['contacted'] || 0 },
            { name: 'Qualified', value: counts['qualified'] || 0 },
            { name: 'Proposal Sent', value: counts['proposal_sent'] || 0 },
            { name: 'Converted', value: counts['converted'] || 0 },
            { name: 'Lost', value: counts['lost'] || 0 },
        ].filter(item => item.value > 0);
    }, [stats.staffLeads]);

    const revenueData = useMemo(() => {
        const converted = stats.staffLeads
            .filter(l => l.status === 'converted' && l.created_at)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        let cumulative = 0;
        const data = converted.map(l => {
            const revenueAmt = getLeadRevenue(l, tours);
            cumulative += revenueAmt;
            return {
                date: format(parseISO(l.created_at), 'MMM d'),
                revenue: cumulative,
                amount: revenueAmt
            };
        });

        if (data.length === 0) {
            return [
                { date: 'No Data', revenue: 0, amount: 0 }
            ];
        }

        return [{ date: 'Start', revenue: 0, amount: 0 }, ...data];
    }, [stats.staffLeads]);

    const emojisList = [
        '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
    ];

    if (!member) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                <p className="text-slate-500 font-semibold">Loading staff details...</p>
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-6rem)] flex flex-col gap-6 animate-in fade-in duration-500 pb-8">
            {/* Header / Back Action */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5 flex-none">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="bg-white/80 backdrop-blur-sm border border-slate-200/60 hover:bg-slate-50 h-10 w-10 rounded-xl"
                        onClick={() => navigate('/staff')}
                    >
                        <ArrowLeft className="h-5 w-5 text-slate-600" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="text-2xl font-black tracking-tight text-slate-900 uppercase leading-none">{member.full_name}</h2>
                            <Badge className="border shadow-none font-black text-[10px] px-3 py-1 rounded-lg uppercase tracking-widest leading-none mt-0.5 bg-indigo-50 text-indigo-700 border-indigo-100">
                                {member.role?.replace('_', ' ')}
                            </Badge>
                        </div>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
                            Account Status: {member.status || 'Active'}
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
                        onClick={handleDeleteStaff}
                    >
                        <Trash2 className="h-4 w-4" /> {t('delete')}
                    </Button>
                </div>
            </div>

            {/* Grid Layout Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
                {/* Left Side: WhatsApp & Directory Table */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    {/* WhatsApp Messages Chat Window */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm flex flex-col h-[550px]">
                        <CardHeader className="border-b border-slate-100 pb-4 flex flex-row items-center justify-between flex-none bg-white">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-blue-500" />
                                WhatsApp Chat History
                            </CardTitle>
                            {member.phone && (
                                <span className="text-[10px] font-bold text-slate-400">{member.phone}</span>
                            )}
                        </CardHeader>
                        
                        {/* Messages Area */}
                        <ScrollArea className="flex-1 p-5 bg-[#efeae2]/10 relative">
                            <div className="absolute inset-0 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] opacity-[0.02] pointer-events-none" />
                            <div className="space-y-4 relative z-10">
                                {!member.phone ? (
                                    <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 text-center px-4">
                                        <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
                                        <p className="text-sm font-semibold text-slate-700">No Phone Number Registered</p>
                                        <p className="text-xs text-slate-400 mt-1 max-w-[280px]">Add a phone number to this staff member to view or send WhatsApp messages.</p>
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 text-center px-4">
                                        <div className="h-12 w-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                                            <Send className="h-5 w-5 text-slate-400" />
                                        </div>
                                        <p className="text-sm font-semibold text-slate-700">No Messages Yet</p>
                                        <p className="text-xs text-slate-400 mt-1">Start chatting with this staff member using the input below.</p>
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
                        {member.phone && (
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

                    {/* Client Directory Luxury Table */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm">
                        <CardHeader className="border-b border-slate-100/50 pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <Users className="h-4 w-4 text-indigo-500" />
                                Client Directory ({stats.totalLeads})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50/50 backdrop-blur-sm border-b border-slate-100">
                                        <tr>
                                            <th className="px-6 py-3.5 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Client Identity</th>
                                            <th className="px-6 py-3.5 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] text-center">Status</th>
                                            <th className="px-6 py-3.5 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">Budget</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {stats.staffLeads.length > 0 ? stats.staffLeads.map((lead) => (
                                            <tr key={lead.id} className="group hover:bg-indigo-50/30 transition-all duration-300">
                                                <td className="px-6 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-[10px] font-black text-indigo-600 shadow-sm transition-transform group-hover:scale-110">
                                                            {lead.name[0]}
                                                        </div>
                                                        <div>
                                                            <p className="text-[12px] font-black text-slate-800 leading-tight">{lead.name}</p>
                                                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Joined {format(parseISO(lead.created_at), 'MMM yyyy')}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3">
                                                    <div className="flex justify-center">
                                                        <Badge className={cn(
                                                            "uppercase text-[7px] font-black tracking-[0.15em] px-2 py-0.5 rounded-full border-none shadow-sm",
                                                            lead.status === 'converted' ? "bg-emerald-500 text-white" :
                                                                lead.status === 'lost' ? "bg-rose-500 text-white" :
                                                                    "bg-indigo-500 text-white"
                                                        )}>
                                                            {lead.status}
                                                        </Badge>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    <p className="text-[12px] font-black text-slate-900 tracking-tight">€{(lead.budget || 0).toLocaleString()}</p>
                                                </td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan={3} className="px-6 py-10 text-center text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] italic">No active records found.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Side: Profile Info, 2x2 Stats, & Compact Charts */}
                <div className="flex flex-col gap-6">
                    {/* Staff Profile Info */}
                    <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
                        <CardHeader className="border-b border-slate-100/50 pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <User className="h-4 w-4 text-indigo-500" />
                                Staff Profile Info
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6 flex flex-col gap-5">
                            <div className="flex items-center gap-4 p-3 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                <Avatar className="h-12 w-12 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                    <AvatarImage src={member.avatar_url} />
                                    <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-black text-sm uppercase">
                                        {member.full_name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="overflow-hidden">
                                    <h4 className="font-bold text-slate-900 text-sm truncate">{member.full_name}</h4>
                                    <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5">{member.role?.replace('_', ' ')}</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Email Address</p>
                                    <p className="text-sm font-bold text-slate-700 truncate mt-1.5">{member.email}</p>
                                </div>

                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Phone Number</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1.5">{member.phone || 'Not Registered'}</p>
                                </div>

                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Department</p>
                                    <p className="text-sm font-bold text-slate-700 mt-1.5">{member.department || 'Operations'}</p>
                                </div>

                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Account Status</p>
                                    <Badge className={cn(
                                        "mt-1.5 uppercase text-[8px] font-black tracking-[0.15em] px-2 py-0.5 rounded-full border-none shadow-sm text-white",
                                        member.status === 'active' || !member.status ? "bg-emerald-500" : "bg-rose-500"
                                    )}>
                                        {member.status || 'active'}
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Stats 2x2 Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Assigned', value: stats.totalLeads, icon: Users, color: 'violet' },
                            { label: 'Converted', value: stats.dealsClosed, icon: CheckCircle2, color: 'emerald' },
                            { label: 'Revenue', value: `€${stats.totalRevenue.toLocaleString()}`, icon: Euro, color: 'indigo' },
                            { label: 'Efficiency', value: `${stats.conversion}%`, icon: TrendingUp, color: 'amber' }
                        ].map((item) => (
                            <Card key={item.label} className="border-none shadow-sm bg-white overflow-hidden group hover:-translate-y-1 transition-all duration-300 rounded-[1.2rem]">
                                <CardContent className="p-3.5 flex flex-col items-center justify-center text-center">
                                    <div className={cn(
                                        "p-2 rounded-xl mb-2 transition-all duration-500 group-hover:rotate-6",
                                        item.color === 'violet' ? "bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white" :
                                            item.color === 'emerald' ? "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white" :
                                                item.color === 'indigo' ? "bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white" :
                                                    "bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white"
                                    )}>
                                        <item.icon className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="text-base font-black text-slate-800 tracking-tight leading-none">{item.value}</div>
                                    <div className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{item.label}</div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Doughnut Chart: Lead Status */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm p-4 flex flex-col items-center">
                        <h4 className="text-[8.5px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 flex items-center gap-1.5 leading-none">
                            <Users className="h-3.5 w-3.5 text-indigo-500" />
                            Lead Status Distribution
                        </h4>
                        {statusData.length > 0 ? (
                            <div className="h-[160px] w-full relative flex items-center justify-center">
                                <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none">Leads</span>
                                    <span className="text-base font-black text-slate-900 leading-none mt-1">{stats.totalLeads}</span>
                                </div>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <defs>
                                            {['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#3b82f6'].map((color, i) => (
                                                <linearGradient key={i} id={`staffPieGradient-${i}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={color} stopOpacity={1} />
                                                    <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                                                </linearGradient>
                                            ))}
                                        </defs>
                                        <Pie
                                            data={statusData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={45}
                                            outerRadius={65}
                                            paddingAngle={3}
                                            dataKey="value"
                                        >
                                            {statusData.map((_entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={`url(#staffPieGradient-${index % 6})`}
                                                    stroke="#fff"
                                                    strokeWidth={2}
                                                    className="focus:outline-none outline-none"
                                                />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    return (
                                                        <div className="bg-white/95 backdrop-blur-xl p-2.5 rounded-xl border border-white shadow-xl">
                                                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">{payload[0].name}</p>
                                                            <div className="flex items-baseline gap-1 mt-0.5">
                                                                <span className="text-base font-black text-slate-900 leading-none">{payload[0].value}</span>
                                                                <span className="text-[9px] font-bold text-slate-500">({Math.round((Number(payload[0].value) / stats.totalLeads) * 100)}%)</span>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-[160px] w-full flex items-center justify-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">No leads assigned</p>
                            </div>
                        )}
                    </Card>

                    {/* Area Chart: Revenue Trend */}
                    <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm p-4 flex flex-col items-center">
                        <h4 className="text-[8.5px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 flex items-center gap-1.5 leading-none">
                            <TrendingUp className="h-3.5 w-3.5 text-violet-500" />
                            Cumulative Revenue Trend
                        </h4>
                        {stats.dealsClosed > 0 ? (
                            <div className="h-[160px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={revenueData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="staffRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(203, 213, 225, 0.4)" />
                                        <XAxis
                                            dataKey="date"
                                            stroke="#94a3b8"
                                            fontSize={8}
                                            fontWeight={700}
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <YAxis
                                            stroke="#94a3b8"
                                            fontSize={8}
                                            fontWeight={700}
                                            tickLine={false}
                                            axisLine={false}
                                            tickFormatter={(val) => `€${val}`}
                                        />
                                        <RechartsTooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const dataPoint = payload[0].payload;
                                                    return (
                                                        <div className="bg-white/95 backdrop-blur-xl p-2.5 rounded-xl border border-white shadow-xl">
                                                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">{dataPoint.date}</p>
                                                            <div className="mt-1">
                                                                <p className="text-[9px] font-bold text-slate-500">Revenue: <span className="font-black text-slate-900">€{dataPoint.revenue.toLocaleString()}</span></p>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="revenue"
                                            stroke="#8b5cf6"
                                            strokeWidth={2.5}
                                            fillOpacity={1}
                                            fill="url(#staffRevenueGradient)"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-[160px] w-full flex items-center justify-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">No closed deals yet</p>
                            </div>
                        )}
                    </Card>
                </div>
            </div>

            {/* Edit Staff Modal */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Staff Details</DialogTitle>
                        <DialogDescription>
                            Update the profile details of this staff member.
                        </DialogDescription>
                    </DialogHeader>
                    <StaffForm
                        initialData={member}
                        onSubmit={handleSaveStaff}
                        onCancel={() => setIsEditDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
