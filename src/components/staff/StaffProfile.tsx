import { useState, useEffect, useMemo, useRef } from 'react';
import {
    Dialog,
    DialogContent,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Mail,
    Phone,
    Euro,
    Users,
    TrendingUp,
    CheckCircle2,
    MessageSquare,
    Send,
    Smile,
    Paperclip,
    CheckCheck,
    Check,
    AlertTriangle,
    Loader2,
    X,
    User
} from 'lucide-react';
import { useAppStore } from '@/store';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { getLeadRevenue } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/Toast';

interface StaffProfileProps {
    staff: any;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function StaffProfile({ staff, open, onOpenChange }: StaffProfileProps) {
    const leads = useAppStore(state => state.leads);
    const tours = useAppStore(state => state.tours);
    const sendWhatsApp = useAppStore(state => state.sendWhatsApp);
    const fetchLeads = useAppStore(state => state.fetchLeads);
    const leadStatuses = useAppStore(state => state.leadStatuses);
    const fetchLeadStatuses = useAppStore(state => state.fetchLeadStatuses);
    const isWonStatus = (status: string) => leadStatuses.find((s) => s.key === status)?.is_closed_won ?? false;

    useEffect(() => {
        if (open && leadStatuses.length <= 1) fetchLeadStatuses();
    }, [open, leadStatuses.length, fetchLeadStatuses]);

    const [messages, setMessages] = useState<any[]>([]);
    const [messageInput, setMessageInput] = useState('');
    const [isEmojiOpen, setIsEmojiOpen] = useState(false);
    const [isAttaching, setIsAttaching] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Ensure matching dummy lead exists for this staff in database so WhatsApp logs can reference it
    useEffect(() => {
        if (!staff || !open) return;
        
        const checkAndCreateDummyLead = async () => {
            const exists = leads.some(l => l.id === staff.id);
            if (!exists) {
                console.log('StaffProfile: Creating dummy lead for staff', staff.id);
                try {
                    const newLead = {
                        id: staff.id,
                        name: staff.full_name,
                        email: staff.email,
                        phone: staff.phone || '',
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
                const dummy = leads.find(l => l.id === staff.id);
                if (dummy && (dummy.phone !== (staff.phone || '') || dummy.name !== staff.full_name || dummy.email !== staff.email)) {
                    console.log('StaffProfile: Updating dummy lead for staff', staff.id);
                    try {
                        await supabase.from('leads').update({
                            name: staff.full_name,
                            email: staff.email,
                            phone: staff.phone || ''
                        }).eq('id', staff.id);
                        await fetchLeads();
                    } catch (err) {
                        console.error('Failed to update dummy lead for staff:', err);
                    }
                }
            }
        };
        checkAndCreateDummyLead();
    }, [staff, leads, open, fetchLeads]);

    // Fetch messages and subscribe to real-time changes
    useEffect(() => {
        if (!staff || !open) return;

        const fetchMessages = async () => {
            try {
                const { data, error } = await supabase
                    .from('whatsapp_messages')
                    .select('*')
                    .eq('lead_id', staff.id)
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
            .channel(`staff-details:${staff.phone || staff.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'whatsapp_messages'
                },
                (payload) => {
                    const newMessage = payload.new;
                    if (newMessage.lead_id === staff.id) {
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
    }, [staff?.id, staff?.phone, open]);

    // Auto-scroll messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !staff.phone) return;

        const currentMsg = messageInput;
        setMessageInput('');

        try {
            await sendWhatsApp(staff.id, staff.phone, currentMsg);
        } catch (error) {
            console.error("Failed to send WhatsApp message to staff:", error);
        }
    };

    const handleEmojiClick = (emoji: string) => {
        setMessageInput(prev => prev + emoji);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !staff.phone) return;

        setIsAttaching(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async (event) => {
                const base64Data = event.target?.result as string;
                await sendWhatsApp(staff.id, staff.phone, base64Data);
                setIsAttaching(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            };
        } catch (err) {
            console.error('Failed to attach file:', err);
            toast.error('Failed to attach image');
            setIsAttaching(false);
        }
    };

    const emojisList = [
        '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
    ];

    const stats = useMemo(() => {
        if (!staff) return { dealsClosed: 0, totalRevenue: 0, conversion: 0, totalLeads: 0, staffLeads: [] };

        const filteredLeads = leads.filter(l => 
            l.source !== 'Staff' && 
            l.source !== 'WhatsApp' && 
            l.source !== 'WhatsApp Sync' && 
            l.source !== 'WhatsApp Web' && 
            l.source !== 'WhatsApp Group'
        );
        const staffLeads = filteredLeads.filter(l => l.assigned_staff_id === staff.id);
        const totalLeads = staffLeads.length;
        const convertedLeads = staffLeads.filter(l => isWonStatus(l.status));

        const dealsClosed = convertedLeads.length;
        const totalRevenue = convertedLeads.reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);
        const conversion = totalLeads > 0 ? Math.round((dealsClosed / totalLeads) * 100) : 0;

        return { dealsClosed, totalRevenue, conversion, totalLeads, staffLeads };
    }, [staff, leads, leadStatuses]);

    if (!staff) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl w-[90vw] max-h-[95vh] overflow-y-auto p-0 border-none shadow-2xl rounded-[2rem] overflow-hidden bg-white/95 backdrop-blur-xl flex flex-col">
                {/* Premium Mesh Gradient Header */}
                <div className="relative p-5 text-white overflow-hidden flex-none">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-700" />
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)`, backgroundSize: '24px 24px' }} />
                    <div className="absolute -top-24 -right-24 w-64 h-64 bg-white/10 rounded-full blur-3xl animate-pulse" />

                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-4">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-tr from-white/40 to-white/0 rounded-full blur opacity-75 group-hover:opacity-100 transition duration-500" />
                            <Avatar className="h-16 w-16 border-4 border-white/30 shadow-2xl relative">
                                <AvatarImage src={staff?.avatar_url} alt={staff?.full_name} className="object-cover" />
                                <AvatarFallback className="text-2xl bg-gradient-to-br from-white/20 to-white/5 text-white font-black">
                                    {staff?.full_name?.[0] || 'U'}
                                </AvatarFallback>
                            </Avatar>
                        </div>

                        <div className="flex-1 text-center md:text-left space-y-3">
                            <div className="flex flex-col md:flex-row md:items-center gap-4">
                                <h3 className="text-2xl font-black tracking-tighter drop-shadow-sm">{staff?.full_name || 'Staff Member'}</h3>
                                <div className="flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/20 w-fit mx-auto md:mx-0">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">{staff?.status || 'Active'}</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-center md:justify-start gap-2">
                                <span className="text-indigo-100/90 font-black uppercase text-[11px] tracking-[0.25em] py-1 px-3 bg-black/10 rounded-lg">
                                    {staff?.role?.replace('_', ' ') || 'Staff'}
                                </span>
                                <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                                <span className="text-indigo-100/90 font-black uppercase text-[11px] tracking-[0.25em]">
                                    {staff?.department || 'Operations'}
                                </span>
                            </div>

                            <div className="flex flex-wrap justify-center md:justify-start gap-5 pt-5 mt-2 border-t border-white/10">
                                <div className="flex items-center gap-2.5 text-sm font-bold text-indigo-50/90 hover:text-white transition-colors cursor-default">
                                    <div className="p-1.5 bg-white/10 rounded-lg"><Mail className="h-3.5 w-3.5" /></div>
                                    {staff?.email}
                                </div>
                                {staff?.phone && (
                                    <div className="flex items-center gap-2.5 text-sm font-bold text-indigo-50/90 hover:text-white transition-colors cursor-default">
                                        <div className="p-1.5 bg-white/10 rounded-lg"><Phone className="h-3.5 w-3.5" /></div>
                                        {staff.phone}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-7 pb-12 bg-slate-50/30 overflow-y-auto flex-1">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Content Area (Left Side) */}
                        <div className="lg:col-span-2 flex flex-col gap-6">
                            {/* Refined Stats Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { label: 'Assigned', value: stats.totalLeads, icon: Users, color: 'violet' },
                                    { label: 'Converted', value: stats.dealsClosed, icon: CheckCircle2, color: 'emerald' },
                                    { label: 'Revenue', value: `€${stats.totalRevenue.toLocaleString()}`, icon: Euro, color: 'indigo' },
                                    { label: 'Efficiency', value: `${stats.conversion}%`, icon: TrendingUp, color: 'amber' }
                                ].map((item) => (
                                    <Card key={item.label} className="border-none shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] bg-white overflow-hidden group hover:-translate-y-1 transition-all duration-300 rounded-[1.5rem]">
                                        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                                            <div className={cn(
                                                "p-2.5 rounded-xl mb-3 transition-all duration-500 group-hover:rotate-6",
                                                item.color === 'violet' ? "bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white" :
                                                    item.color === 'emerald' ? "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white" :
                                                        item.color === 'indigo' ? "bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white" :
                                                            "bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white"
                                            )}>
                                                <item.icon className="h-4 w-4" />
                                            </div>
                                            <div className="text-xl font-black text-slate-800 tracking-tight">{item.value}</div>
                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">{item.label}</div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>

                            {/* Client Directory Luxury Table */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="h-1 w-6 rounded-full bg-indigo-600" />
                                    <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.3em]">Client Directory ({stats.totalLeads})</h4>
                                </div>
                                <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white rounded-[2rem] overflow-hidden">
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
                                                                    isWonStatus(lead.status) ? "bg-emerald-500 text-white" :
                                                                        leadStatuses.find((s) => s.key === lead.status)?.is_closed_lost ? "bg-rose-500 text-white" :
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
                                </Card>
                            </div>

                            {/* WhatsApp Messages Chat Window */}
                            <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-white/70 backdrop-blur-sm flex flex-col h-[400px]">
                                <div className="p-4 border-b border-slate-100 flex flex-row items-center justify-between flex-none bg-white">
                                    <div className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                        <MessageSquare className="h-4 w-4 text-blue-500" />
                                        WhatsApp Chat History
                                    </div>
                                    {staff.phone && (
                                        <span className="text-[10px] font-bold text-slate-400">{staff.phone}</span>
                                    )}
                                </div>
                                
                                {/* Messages Area */}
                                <ScrollArea className="flex-1 p-5 bg-[#efeae2]/10 relative">
                                    <div className="absolute inset-0 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] opacity-[0.02] pointer-events-none" />
                                    <div className="space-y-4 relative z-10">
                                        {!staff.phone ? (
                                            <div className="flex flex-col items-center justify-center h-[220px] text-slate-400 text-center px-4">
                                                <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
                                                <p className="text-sm font-semibold text-slate-700">No Phone Number Registered</p>
                                                <p className="text-xs text-slate-400 mt-1 max-w-[280px]">Add a phone number to this staff member to view or send WhatsApp messages.</p>
                                            </div>
                                        ) : messages.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-[220px] text-slate-400 text-center px-4">
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
                                                                "max-w-[75%] rounded-lg px-4 py-2 shadow-sm relative group transition-all duration-300",
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
                                {staff.phone && (
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

                        {/* Sidebar Information Panel (Right Side) */}
                        <div className="flex flex-col gap-6">
                            <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
                                <div className="p-4 border-b border-slate-100 flex flex-row items-center gap-2 bg-white">
                                    <User className="h-4 w-4 text-indigo-500" />
                                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">Staff Profile Info</span>
                                </div>
                                <CardContent className="pt-6 flex flex-col gap-5">
                                    <div className="flex items-center gap-4 p-3 bg-slate-50/50 border border-slate-100 rounded-2xl">
                                        <Avatar className="h-12 w-12 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                            <AvatarImage src={staff.avatar_url} />
                                            <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-black text-sm uppercase">
                                                {staff.full_name.split(' ').map((n: string) => n[0]).join('').substring(0, 2)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="overflow-hidden">
                                            <h4 className="font-bold text-slate-900 text-sm truncate">{staff.full_name}</h4>
                                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5">{staff.role?.replace('_', ' ')}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Email Address</p>
                                            <p className="text-sm font-bold text-slate-700 truncate mt-1.5">{staff.email}</p>
                                        </div>

                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Phone Number</p>
                                            <p className="text-sm font-bold text-slate-700 mt-1.5">{staff.phone || 'Not Registered'}</p>
                                        </div>

                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Department</p>
                                            <p className="text-sm font-bold text-slate-700 mt-1.5">{staff.department || 'Operations'}</p>
                                        </div>

                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">Account Status</p>
                                            <Badge className={cn(
                                                "mt-1.5 uppercase text-[8px] font-black tracking-[0.15em] px-2 py-0.5 rounded-full border-none shadow-sm text-white",
                                                staff.status === 'active' || !staff.status ? "bg-emerald-500" : "bg-rose-500"
                                            )}>
                                                {staff.status || 'active'}
                                            </Badge>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
