import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { getStatusConfig, statusBadgeClass, PRIORITY_CONFIG, formatLeadNumber } from '@/lib/leadUtils';
import { QuickFollowUpModal } from '@/components/shared/QuickFollowUpModal';
import {
    ExternalLink, CalendarPlus, FileText, User, Tag, Briefcase, Clock, UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function WhatsAppLeadInfoPanel({ leadId }: { leadId: string | null }) {
    const { leads, staff, leadStatuses, followups, updateLead, conversations, assignConversation, setConversationStatus } = useAppStore();
    const navigate = useNavigate();
    const [followUpOpen, setFollowUpOpen] = useState(false);

    const lead = leadId ? leads.find((l) => l.id === leadId) : null;
    const digitsOnly = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);
    const conversation = lead
        ? conversations.find((c) => c.contact_lead_id === lead.id) || conversations.find((c) => digitsOnly(c.phone) === digitsOnly(lead.phone))
        : null;
    const conversationAssignee = conversation ? staff.find((s) => s.id === conversation.assigned_staff_id) : null;

    if (!lead) {
        return (
            <div className="hidden xl:flex w-80 flex-shrink-0 border-l border-slate-200 bg-slate-50/50 flex-col items-center justify-center text-center px-6">
                <User className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-xs font-bold text-slate-400">Select a conversation to see lead details.</p>
            </div>
        );
    }

    const statusCfg = getStatusConfig(leadStatuses, lead.status);
    const priorityCfg = PRIORITY_CONFIG[lead.priority || 'medium'];
    const assignedStaff = staff.find((s) => s.id === lead.assigned_staff_id);
    const pendingFollowUp = followups.find((f) => f.lead_id === lead.id && f.status === 'pending');

    return (
        <div className="hidden xl:flex w-80 flex-shrink-0 border-l border-slate-200 bg-white flex-col overflow-y-auto">
            <div className="p-5 border-b border-slate-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Lead Details</p>
                <button onClick={() => navigate(`/leads/${lead.id}`)} className="w-full text-left group">
                    <p className="text-sm font-black text-slate-900 group-hover:text-indigo-600 flex items-center gap-1.5">
                        {lead.name} <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">{formatLeadNumber(lead)}</p>
                </button>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    <Badge className={cn('border shadow-none font-black text-[9px] px-2 py-0.5 rounded-lg uppercase', statusBadgeClass(statusCfg.color))}>{statusCfg.label}</Badge>
                    <Badge className={cn('border shadow-none font-black text-[9px] px-2 py-0.5 rounded-lg uppercase', priorityCfg.className)}>{priorityCfg.label}</Badge>
                </div>
            </div>

            <div className="p-5 space-y-4 border-b border-slate-100">
                <InfoRow icon={Tag} label="Source" value={lead.source} />
                <InfoRow icon={Briefcase} label="Requirement" value={lead.requirement || lead.tour_interest} />
                <InfoRow icon={UserCheck} label="Assigned To" value={assignedStaff?.full_name} />
                <InfoRow
                    icon={Clock}
                    label="Next Follow-up"
                    value={pendingFollowUp ? new Date(pendingFollowUp.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : undefined}
                />
            </div>

            {conversation && (
                <div className="p-5 space-y-3 border-b border-slate-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">WhatsApp Conversation</p>
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-1.5">Conversation Status</p>
                        <Select value={conversation.status} onValueChange={(v) => setConversationStatus(conversation.id, v as 'open' | 'pending' | 'resolved')}>
                            <SelectTrigger className="h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="open">Open</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="resolved">Resolved</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-1.5">Assigned Agent</p>
                        <Select
                            value={conversation.assigned_staff_id || 'unassigned'}
                            onValueChange={(v) => {
                                const staffMember = staff.find((s) => s.id === v);
                                assignConversation(conversation.id, v === 'unassigned' ? null : v, staffMember?.full_name);
                            }}
                        >
                            <SelectTrigger className="h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {conversationAssignee && (
                            <p className="text-[10px] text-slate-400 font-semibold mt-1">Currently: {conversationAssignee.full_name}</p>
                        )}
                    </div>
                </div>
            )}

            <div className="p-5 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Change Status</p>
                <Select value={lead.status} onValueChange={(v) => updateLead(lead.id, { status: v })}>
                    <SelectTrigger className="h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {leadStatuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                    </SelectContent>
                </Select>

                <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button variant="outline" size="sm" className="text-xs font-bold" onClick={() => navigate(`/leads/${lead.id}`)}>
                        Update Lead
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs font-bold" onClick={() => setFollowUpOpen(true)}>
                        <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Follow-up
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs font-bold col-span-2" onClick={() => navigate(`/leads/${lead.id}`, { state: { tab: 'documents' } })}>
                        <FileText className="h-3.5 w-3.5 mr-1" /> Create Quotation
                    </Button>
                </div>
            </div>

            <QuickFollowUpModal open={followUpOpen} onOpenChange={setFollowUpOpen} />
        </div>
    );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
    return (
        <div className="flex items-start gap-2.5">
            <Icon className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">{label}</p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">{value || 'Not set'}</p>
            </div>
        </div>
    );
}
