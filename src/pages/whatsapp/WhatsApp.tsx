import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { WhatsAppLeadInfoPanel } from '@/components/whatsapp/WhatsAppLeadInfoPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/Toast';

import { Search, MoreVertical, Paperclip, Send, Smile, CheckCheck, Check, AlertTriangle, Users, Loader2, X, Plus, RefreshCw, Edit, Trash2, Forward } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useAppStore } from '@/store';
import { supabase, anonClient, API_BASE, getAuthToken } from '@/lib/supabase';
import { getWhatsAppWindowStatus, WhatsAppSessionWindowError } from '@/lib/api';

import type { Lead, WhatsAppTemplate } from '@/types';

type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';

type Message = {
    id: string;
    content: string;
    sender: 'user' | 'contact';
    timestamp: Date;
    status: MessageStatus;
    errorMessage?: string | null;
};

type Contact = {
    id: string;
    name: string;
    avatar: string;
    lastMessage: string;
    lastMessageTime: Date;
    unreadCount?: number;
    status: 'online' | 'offline';
    phone: string;
    source?: string;
    notes?: string;
};

export function WhatsApp() {
    const rawLeads = useAppStore(state => state.leads);
    const leads = rawLeads;
    const fetchLeads = useAppStore(state => state.fetchLeads);
    const sendWhatsApp = useAppStore(state => state.sendWhatsApp);
    const deleteWhatsAppMessage = useAppStore(state => state.deleteWhatsAppMessage);
    const updateWhatsAppMessage = useAppStore(state => state.updateWhatsAppMessage);
    const staff = useAppStore(state => state.staff);
    const fetchStaff = useAppStore(state => state.fetchStaff);
    const updateLead = useAppStore(state => state.updateLead);
    const deleteLead = useAppStore(state => state.deleteLead);
    const conversations = useAppStore(state => state.conversations);
    const markConversationReadInStore = useAppStore(state => state.markConversationRead);
    const location = useLocation();
    const navigate = useNavigate();

    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [messageInput, setMessageInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [lastMessages, setLastMessages] = useState<Record<string, { content: string, created_at: string }>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [dbError, setDbError] = useState(false);
    const [isLastMessagesLoaded, setIsLastMessagesLoaded] = useState(false);

    // Edit message state
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

    // Forward message states
    const [isForwardOpen, setIsForwardOpen] = useState(false);
    const [forwardContent, setForwardContent] = useState('');
    const [selectedContactsForForward, setSelectedContactsForForward] = useState<string[]>([]);
    const [forwardSearchTerm, setForwardSearchTerm] = useState('');



    // Emoji Picker, Search and Attachment states
    const [isEmojiOpen, setIsEmojiOpen] = useState(false);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [messageSearchQuery, setMessageSearchQuery] = useState('');
    const [isAttaching, setIsAttaching] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Dialog states for Group Chats
    const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);

    const [isEditGroupOpen, setIsEditGroupOpen] = useState(false);
    const [editGroupName, setEditGroupName] = useState('');
    const [editGroupMembers, setEditGroupMembers] = useState<string[]>([]);

    // Contact edit and delete states
    const [isEditContactOpen, setIsEditContactOpen] = useState(false);
    const [editContactName, setEditContactName] = useState('');
    const [editContactPhone, setEditContactPhone] = useState('');
    const [editContactEmail, setEditContactEmail] = useState('');
    const [isUpdatingContact, setIsUpdatingContact] = useState(false);

    const [isDeleteContactOpen, setIsDeleteContactOpen] = useState(false);
    const [isDeletingContact, setIsDeletingContact] = useState(false);

    // 24-hour WhatsApp session window + template picker (required to re-open a closed chat)
    const [windowStatus, setWindowStatus] = useState<{ withinWindow: boolean; lastInboundAt: string | null } | null>(null);
    const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
    const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
    const [templatePickerSid, setTemplatePickerSid] = useState('');
    const [templatePickerVars, setTemplatePickerVars] = useState('');
    const [isSendingTemplate, setIsSendingTemplate] = useState(false);

    // Set edit inputs when selected group chat changes
    useEffect(() => {
        if (selectedContact && (selectedContact as any).source === 'WhatsApp Group') {
            setEditGroupName(selectedContact.name);
            try {
                const membersObj = JSON.parse((selectedContact as any).notes || '{"members":[]}');
                setEditGroupMembers(membersObj.members || []);
            } catch (err) {
                setEditGroupMembers([]);
            }
        }
    }, [selectedContact]);

    const handleCreateGroup = async () => {
        if (!newGroupName.trim() || selectedGroupMembers.length === 0) return;
        
        try {
            const newGroupId = crypto.randomUUID();
            const groupLead = {
                id: newGroupId,
                name: newGroupName,
                email: 'group@whatsapp.crm',
                phone: 'group-' + newGroupId.substring(0, 8),
                status: 'converted' as const,
                source: 'WhatsApp Group',
                created_at: new Date().toISOString(),
                notes: JSON.stringify({ members: selectedGroupMembers })
            };
            
            const { error } = await supabase.from('leads').insert([groupLead]);
            if (error) throw error;
            
            toast.success('WhatsApp group created successfully');
            setIsNewGroupOpen(false);
            await fetchLeads();
            
            // Auto select new group
            const avatar = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(newGroupName)}`;
            setSelectedContact({
                id: newGroupId,
                name: newGroupName,
                avatar: avatar,
                lastMessage: 'No group messages yet',
                lastMessageTime: new Date(),
                status: 'online',
                phone: groupLead.phone,
                source: 'WhatsApp Group',
                leadIds: [newGroupId],
                notes: groupLead.notes
            } as any);
        } catch (err: any) {
            console.error('Failed to create group:', err);
            toast.error('Failed to create group: ' + err.message);
        }
    };

    const handleUpdateGroup = async () => {
        if (!selectedContact || !editGroupName.trim() || editGroupMembers.length === 0) return;
        
        try {
            const updatedNotes = JSON.stringify({ members: editGroupMembers });
            const { error } = await supabase
                .from('leads')
                .update({
                    name: editGroupName,
                    notes: updatedNotes
                })
                .eq('id', selectedContact.id);
                
            if (error) throw error;
            
            toast.success('Group updated successfully');
            setIsEditGroupOpen(false);
            await fetchLeads();
            
            // Update local selection
            setSelectedContact(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    name: editGroupName,
                    notes: updatedNotes
                } as any;
            });
        } catch (err: any) {
            console.error('Failed to update group:', err);
            toast.error('Failed to update group: ' + err.message);
        }
    };

    const handleUpdateContact = async () => {
        if (!selectedContact) return;
        if (!editContactName.trim() || !editContactPhone.trim()) {
            toast.error("Name and phone number are required.");
            return;
        }

        setIsUpdatingContact(true);
        try {
            const targetLeadIds = (selectedContact as any).leadIds || [selectedContact.id];

            // Update all duplicate leads associated with this contact's phone
            await Promise.all(targetLeadIds.map((leadId: string) => 
                updateLead(leadId, {
                    name: editContactName,
                    phone: editContactPhone,
                    email: editContactEmail
                })
            ));

            toast.success('Contact updated successfully');
            setIsEditContactOpen(false);
            await fetchLeads();

            // Update local selection with new details
            setSelectedContact(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    name: editContactName,
                    phone: editContactPhone,
                    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(editContactName)}`,
                } as any;
            });
        } catch (err: any) {
            console.error('Failed to update contact:', err);
            toast.error('Failed to update contact: ' + err.message);
        } finally {
            setIsUpdatingContact(false);
        }
    };

    const handleDeleteContact = async () => {
        if (!selectedContact) return;
        setIsDeletingContact(true);
        try {
            const targetLeadIds = (selectedContact as any).leadIds || [selectedContact.id];

            // Delete (soft-delete) all matching leads
            await Promise.all(targetLeadIds.map((leadId: string) => deleteLead(leadId)));

            toast.success(
                (selectedContact as any).source === 'WhatsApp Group' 
                    ? 'Group list deleted successfully' 
                    : 'Contact deleted successfully'
            );
            setIsDeleteContactOpen(false);

            // Fetch fresh leads list
            await fetchLeads();

            // Deselect contact
            setSelectedContact(null);
        } catch (err: any) {
            console.error('Failed to delete contact:', err);
            toast.error('Failed to delete contact: ' + err.message);
        } finally {
            setIsDeletingContact(false);
        }
    };

    // Twilio message sync function (fetched via our backend, which holds the Twilio credentials)
    const syncTwilioMessages = async (showToast = false) => {
        if (showToast) toast.info('Syncing WhatsApp messages from Twilio...');
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_BASE}/api/whatsapp/twilio-messages`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (!res.ok) {
                throw new Error('Failed to fetch from Twilio: ' + res.statusText);
            }
            const data = await res.json();
            const twilioMessages = data.messages || [];

            const phoneToMsgs: Record<string, any[]> = {};
            twilioMessages.forEach((msg: any) => {
                if (!msg.from.startsWith('whatsapp:') || !msg.to.startsWith('whatsapp:')) return;

                const fromNum = msg.from.replace('whatsapp:', '');
                const toNum = msg.to.replace('whatsapp:', '');

                const ourNum = data.ourNumber || '';
                const cleanOurNum = ourNum.replace('whatsapp:', '').trim();

                const otherNum = (fromNum === cleanOurNum) ? toNum : fromNum;
                
                if (!phoneToMsgs[otherNum]) {
                    phoneToMsgs[otherNum] = [];
                }
                phoneToMsgs[otherNum].push(msg);
            });

            let syncedLeadsCount = 0;
            let syncedMessagesCount = 0;

            // Fetch all leads (including soft-deleted ones) from the database to check for matching phone numbers
            const { data: dbLeads, error: dbLeadsErr } = await supabase
                .from('leads')
                .select('*');

            if (dbLeadsErr) {
                console.error('Sync: Failed to fetch leads from DB:', dbLeadsErr);
                return;
            }

            for (const [phone, msgs] of Object.entries(phoneToMsgs)) {
                const normalizedSearch = phone.replace(/\D/g, '');
                
                let matchingLead = dbLeads.find((l: any) => {
                    if (!l.phone) return false;
                    const cleanLeadPhone = l.phone.replace(/\D/g, '');
                    return cleanLeadPhone === normalizedSearch || 
                           cleanLeadPhone.endsWith(normalizedSearch) || 
                           normalizedSearch.endsWith(cleanLeadPhone);
                });

                if (matchingLead) {
                    // If the matched lead was soft-deleted, restore it in the DB!
                    if ((matchingLead as any).is_deleted) {
                        console.log('Sync: Restoring soft-deleted lead for phone:', phone);
                        const { error: restoreError } = await supabase
                            .from('leads')
                            .update({ is_deleted: false })
                            .eq('id', matchingLead.id);
                        if (restoreError) {
                            console.error('Sync: Failed to restore lead:', restoreError);
                        } else {
                            (matchingLead as any).is_deleted = false;
                        }
                    }
                 } else {
                    console.log('Sync: Creating lead for phone:', phone);
                    try {
                        const newGroupId = crypto.randomUUID();
                        let { data: inserted, error } = await supabase
                            .from('leads')
                            .insert({
                                id: newGroupId,
                                name: `WhatsApp (${phone})`,
                                phone: phone,
                                email: `${normalizedSearch}@whatsapp.crm`,
                                source: 'WhatsApp Sync',
                                status: 'new',
                                is_deleted: false
                            })
                            .select()
                            .single();
                        
                        if (error && (error.message?.includes('is_deleted') || error.code === 'PGRST100')) {
                            const fallbackResult = await supabase
                                .from('leads')
                                .insert({
                                    id: newGroupId,
                                    name: `WhatsApp (${phone})`,
                                    phone: phone,
                                    email: `${normalizedSearch}@whatsapp.crm`,
                                    source: 'WhatsApp Sync',
                                    status: 'new'
                                })
                                .select()
                                .single();
                            inserted = fallbackResult.data;
                            error = fallbackResult.error;
                        }
                        
                        if (error) throw error;
                        matchingLead = inserted as Lead;
                        syncedLeadsCount++;
                    } catch (err) {
                        console.error('Failed to create lead during sync:', err);
                        continue;
                    }
                }

                if (!matchingLead) continue;

                const { data: dbMsgs, error: dbMsgsErr } = await supabase
                    .from('whatsapp_messages')
                    .select('*')
                    .eq('lead_id', matchingLead.id);
                
                if (dbMsgsErr) {
                    console.error('Failed to fetch DB messages for sync:', dbMsgsErr);
                    continue;
                }

                for (const tMsg of msgs) {
                    const isUser = tMsg.direction.startsWith('outbound');
                    const sender = isUser ? 'user' : 'contact';
                    
                    const msgExists = dbMsgs.some((dm: any) =>
                        dm.content === tMsg.body && 
                        Math.abs(new Date(dm.created_at).getTime() - new Date(tMsg.date_created).getTime()) < 10000
                    );

                    if (!msgExists) {
                        const { error: insErr } = await supabase
                            .from('whatsapp_messages')
                            .insert({
                                lead_id: matchingLead.id,
                                sender: sender,
                                content: tMsg.body,
                                status: tMsg.status === 'read' || tMsg.status === 'delivered' ? 'read' : 'sent',
                                created_at: new Date(tMsg.date_created).toISOString()
                            });
                        
                        if (insErr) {
                            console.error('Failed to insert message during sync:', insErr);
                        } else {
                            syncedMessagesCount++;
                        }
                    }
                }
            }

            if (showToast) {
                toast.success(`Sync Complete! Added ${syncedLeadsCount} new contacts and synced ${syncedMessagesCount} new messages.`);
            } else if (syncedLeadsCount > 0 || syncedMessagesCount > 0) {
                toast.success(`Sync updated: Added ${syncedLeadsCount} new contacts and synced ${syncedMessagesCount} new messages.`);
            }
            await fetchLeads();
            fetchLastMessages();
        } catch (error: any) {
            console.error('Sync failed:', error);
            toast.error('Sync failed: ' + error.message);
        }
    };

    const emojis = [
        '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
    ];

    const handleEmojiClick = (emoji: string) => {
        setMessageInput(prev => prev + emoji);
    };

    const handleAttachmentClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedContact) return;

        setIsAttaching(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async (event) => {
                const base64Data = event.target?.result as string;
                await sendWhatsApp(selectedContact.id, selectedContact.phone, base64Data);
                setIsAttaching(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            };
        } catch (err) {
            console.error('Failed to attach file:', err);
            toast.error('Failed to attach image');
            setIsAttaching(false);
        }
    };

    // Auto-enable broadcast if triggered from dashboard navigation state
    useEffect(() => {
        if (location.state?.startBroadcast) {
            setIsBroadcastMode(true);
            setSelectedContactsForBroadcast([]);
            setIsBroadcastConfirmOpen(false);
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    // Broadcast Mode States
    const [isBroadcastMode, setIsBroadcastMode] = useState(false);
    const [selectedContactsForBroadcast, setSelectedContactsForBroadcast] = useState<string[]>([]);
    const [isBroadcastConfirmOpen, setIsBroadcastConfirmOpen] = useState(false);
    const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);
    const [broadcastMessage, setBroadcastMessage] = useState('');
    const [useBroadcastTemplate, setUseBroadcastTemplate] = useState(false);
    const [broadcastTemplateSid, setBroadcastTemplateSid] = useState('HX2ada749a93d94f4a77cf706c63173358');
    const [broadcastTemplateVars, setBroadcastTemplateVars] = useState('');

    const approvedTemplates = [
        {
            name: 'Welcome Template (errances_welcome)',
            sid: 'HX2ada749a93d94f4a77cf706c63173358',
            body: 'Hello {{1}}, thank you for contacting Errances Voyages! We have received your inquiry. A travel specialist will get back to you shortly. How can we help you today?'
        }
    ];

    const sandboxTemplates = [
        `Your appointment is coming up on May 27 at 10:00 AM`,
        `Your Errances Voyages order of Bali package has shipped and should be delivered on June 1. Details: http://localhost:5173`,
        `Your Errances Voyages code is 849310`
    ];

    const suggestedMessages = [
        `Hello, thank you for your interest in Errances Voyages! How can we help you today?`,
        `Hi, I'm following up on your inquiry. Do you have any questions?`,
    ];

    const handleSendBroadcast = async () => {
        if (!useBroadcastTemplate && !broadcastMessage.trim()) return;
        if (useBroadcastTemplate && !broadcastTemplateSid.trim()) return;

        setIsSendingBroadcast(true);
        try {
            let parsedVars: Record<string, string> | undefined = undefined;
            if (useBroadcastTemplate && broadcastTemplateVars.trim()) {
                parsedVars = {};
                broadcastTemplateVars.split(',').forEach((val, idx) => {
                    parsedVars![(idx + 1).toString()] = val.trim();
                });
            }

            const finalMessage = useBroadcastTemplate
                ? (broadcastMessage.trim() || `[Template Sent: ${broadcastTemplateSid}]${broadcastTemplateVars ? ` with variables: ${broadcastTemplateVars}` : ''}`)
                : broadcastMessage;

            const selectedLeads = leads.filter(l => selectedContactsForBroadcast.includes(l.id));

            let successCount = 0;
            let failCount = 0;

            for (const lead of selectedLeads) {
                try {
                    await sendWhatsApp(
                        lead.id,
                        lead.phone,
                        finalMessage,
                        useBroadcastTemplate ? broadcastTemplateSid.trim() : undefined,
                        parsedVars
                    );
                    successCount++;
                } catch (err) {
                    console.error(`Failed to send broadcast to ${lead.name}:`, err);
                    failCount++;
                }
            }

            if (failCount === 0) {
                toast.success(`Broadcast finished: Sent to ${successCount} leads successfully.`);
            } else {
                toast.success(`Broadcast finished: Sent to ${successCount} leads. Failed for ${failCount} leads.`);
            }

            // Reset states
            setBroadcastMessage('');
            setBroadcastTemplateVars('');
            setUseBroadcastTemplate(false);
            setIsBroadcastMode(false);
            setSelectedContactsForBroadcast([]);
            setIsBroadcastConfirmOpen(false);
            
            // Refetch messages to update the lists
            fetchLastMessages();
        } catch (error) {
            console.error('Failed to run broadcast:', error);
        } finally {
            setIsSendingBroadcast(false);
        }
    };
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initial fetch of leads and staff
    useEffect(() => {
        fetchLeads();
        fetchStaff();
    }, [fetchLeads, fetchStaff]);

    // Ensure matching dummy lead exists for all staff members who have a phone number
    useEffect(() => {
        if (staff.length === 0) return;
        
        const syncStaffDummyLeads = async () => {
            let needsFetch = false;
            for (const member of staff) {
                if (!member.phone || member.phone.trim() === '') continue;
                
                const exists = rawLeads.some(l => l.id === member.id);
                if (!exists) {
                    console.log('WhatsApp: Creating dummy lead for staff', member.id);
                    try {
                        const newLead = {
                            id: member.id,
                            name: member.full_name,
                            email: member.email,
                            phone: member.phone,
                            status: 'converted' as const,
                            source: 'Staff',
                            created_at: new Date().toISOString()
                        };
                        await supabase.from('leads').insert([newLead]);
                        needsFetch = true;
                    } catch (err) {
                        console.error('Failed to create dummy lead for staff:', err);
                    }
                } else {
                    // Keep dummy lead in sync if name, email, or phone changed
                    const dummy = rawLeads.find(l => l.id === member.id);
                    if (dummy && (dummy.phone !== member.phone || dummy.name !== member.full_name || dummy.email !== member.email)) {
                        console.log('WhatsApp: Updating dummy lead for staff', member.id);
                        try {
                            await supabase.from('leads').update({
                                name: member.full_name,
                                email: member.email,
                                phone: member.phone
                            }).eq('id', member.id);
                            needsFetch = true;
                        } catch (err) {
                            console.error('Failed to update dummy lead for staff:', err);
                        }
                    }
                }
            }
            if (needsFetch) {
                await fetchLeads();
            }
        };
        
        syncStaffDummyLeads();
    }, [staff, rawLeads, fetchLeads]);

    // Fetch last messages to show in the sidebar list
    const fetchLastMessages = async () => {
        try {
            console.log('[WhatsApp Debug] fetchLastMessages initiating...');
            const { data: { session } } = await supabase.auth.getSession();
            const client = session ? supabase : anonClient;
            const { data, error } = await client
                .from('whatsapp_messages')
                .select('lead_id, content, created_at')
                .order('created_at', { ascending: false });
            console.log('[WhatsApp Debug] fetchLastMessages result:', { count: data?.length, error });
            if (!error && data) {
                setDbError(false);
                const mapping: Record<string, { content: string, created_at: string }> = {};
                data.forEach((m: any) => {
                    if (!mapping[m.lead_id]) {
                        mapping[m.lead_id] = { content: m.content, created_at: m.created_at };
                    }
                });
                setLastMessages(mapping);
            } else if (error) {
                console.warn('Error querying whatsapp last messages:', error.message);
                if (error.code === 'PGRST205') {
                    setDbError(true);
                }
            }
        } catch (e) {
            console.error('Failed to fetch last messages:', e);
            setDbError(true);
        } finally {
            setIsLastMessagesLoaded(true);
        }
    };

    useEffect(() => {
        if (leads.length > 0) {
            fetchLastMessages();
        }
    }, [leads]);

    // Background sync of Twilio messages on mount
    useEffect(() => {
        syncTwilioMessages(false);
    }, []);

    // Normalize phone helper
    const normalizePhone = (phone: string) => {
        const digits = phone.replace(/\D/g, '');
        return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    // Group leads by normalized phone number
    const leadsByPhone = useMemo(() => {
        const groups: Record<string, typeof leads> = {};
        leads.forEach(lead => {
            if (lead.source === 'WhatsApp Group') return; // Skip groups from phone grouping
            if (lead.phone && lead.phone.trim() !== '') {
                const norm = normalizePhone(lead.phone);
                if (!groups[norm]) {
                    groups[norm] = [];
                }
                groups[norm].push(lead);
            }
        });
        return groups;
    }, [leads]);

    // Deriving contacts list grouped by phone number to combine duplicates and show all messages
    const contacts: Contact[] = useMemo(() => {
        const list: Contact[] = [];
        
        // 1. Add individual contacts grouped by phone
        Object.entries(leadsByPhone).forEach(([_, phoneLeads]) => {
            // Find the most recent lead in this group to use as primary metadata
            const sortedLeads = [...phoneLeads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const primaryLead = sortedLeads[0];
            
            // Get all lead IDs for this phone number group
            const leadIds = phoneLeads.map(l => l.id);
            
            // Find the most recent message across all these lead IDs
            let lastMsg: { content: string; created_at: string } | null = null;
            for (const id of leadIds) {
                const msg = lastMessages[id];
                if (msg) {
                    if (!lastMsg || new Date(msg.created_at).getTime() > new Date(lastMsg.created_at).getTime()) {
                        lastMsg = msg;
                    }
                }
            }

            // Combine names if they are different
            const uniqueNames = Array.from(new Set(phoneLeads.map(l => l.name)));
            const combinedName = uniqueNames.join(' / ');

            list.push({
                id: primaryLead.id,
                name: combinedName,
                avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(primaryLead.name)}`,
                lastMessage: lastMsg ? (lastMsg.content.startsWith('data:image/') ? '📷 Photo' : lastMsg.content) : (primaryLead.notes || 'No messages yet'),
                lastMessageTime: lastMsg ? new Date(lastMsg.created_at) : new Date(primaryLead.created_at),
                status: 'online' as const,
                phone: primaryLead.phone,
                source: primaryLead.source,
                leadIds: leadIds // Include all linked lead IDs
            } as any);
        });

        // 2. Add group contacts (source === 'WhatsApp Group')
        const groupLeads = leads.filter(l => l.source === 'WhatsApp Group');
        groupLeads.forEach(group => {
            const lastMsg = lastMessages[group.id];
            list.push({
                id: group.id,
                name: group.name,
                avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(group.name)}`,
                lastMessage: lastMsg ? (lastMsg.content.startsWith('data:image/') ? '📷 Photo' : lastMsg.content) : 'No group messages yet',
                lastMessageTime: lastMsg ? new Date(lastMsg.created_at) : new Date(group.created_at),
                status: 'online' as const,
                phone: group.phone || '',
                source: 'WhatsApp Group',
                leadIds: [group.id],
                notes: group.notes // Stores members list JSON string
            } as any);
        });

        // Sort by last message time descending
        return list.sort((a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime());
    }, [leadsByPhone, leads, lastMessages]);

    // Unread WhatsApp counts per contact, matched by phone (last 10 digits, to survive
    // +91/country-code and formatting differences between the leads table and Twilio).
    const digitsOnly = (p: string) => (p || '').replace(/\D/g, '').slice(-10);
    const unreadByPhone = useMemo(() => {
        const map: Record<string, { count: number; conversationId: string }> = {};
        for (const c of conversations) {
            if (c.unread_count <= 0) continue;
            const key = digitsOnly(c.phone);
            if (!key) continue;
            map[key] = { count: (map[key]?.count || 0) + c.unread_count, conversationId: c.id };
        }
        return map;
    }, [conversations]);

    // Set initial selected contact
    useEffect(() => {
        if (isLastMessagesLoaded && contacts.length > 0 && !selectedContact) {
            setSelectedContact(contacts[0]);
        }
    }, [contacts, selectedContact, isLastMessagesLoaded]);

    // Mark the matching conversation read when it's opened in the inbox.
    useEffect(() => {
        if (!selectedContact) return;
        const entry = unreadByPhone[digitsOnly(selectedContact.phone)];
        if (entry) markConversationReadInStore(entry.conversationId).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedContact?.phone]);

    // Load active approved templates once — used by the template picker below.
    useEffect(() => {
        supabase.from('whatsapp_templates').select('*').eq('is_active', true).eq('status', 'approved').order('created_at', { ascending: false })
            .then(({ data, error }: any) => { if (!error && data) setTemplates(data); })
            .catch(() => {});
    }, []);

    // Track whether the active chat is inside WhatsApp's 24h free-form session window.
    useEffect(() => {
        if (!selectedContact?.phone) { setWindowStatus(null); return; }
        let cancelled = false;
        getWhatsAppWindowStatus(selectedContact.phone).then((status) => {
            if (!cancelled) setWindowStatus(status);
        }).catch(() => { if (!cancelled) setWindowStatus(null); });
        return () => { cancelled = true; };
    }, [selectedContact?.phone, messages.length]);

    const handleSendTemplate = async () => {
        if (!selectedContact || !templatePickerSid) return;
        setIsSendingTemplate(true);
        try {
            const template = templates.find(t => t.twilio_content_sid === templatePickerSid);
            const variables: Record<string, string> = {};
            if (templatePickerVars.trim()) {
                templatePickerVars.split(',').forEach((val, idx) => { variables[String(idx + 1)] = val.trim(); });
            }
            await sendWhatsApp(
                selectedContact.id,
                selectedContact.phone,
                template?.body_preview || `[Template ${templatePickerSid}]`,
                templatePickerSid,
                Object.keys(variables).length ? variables : undefined
            );
            toast.success('Template sent — the 24-hour window is now open.');
            setIsTemplatePickerOpen(false);
            setTemplatePickerSid('');
            setTemplatePickerVars('');
            getWhatsAppWindowStatus(selectedContact.phone).then(setWindowStatus).catch(() => {});
        } catch (err: any) {
            toast.error(err?.message || 'Failed to send template');
        } finally {
            setIsSendingTemplate(false);
        }
    };

    // Subscribe to leads database changes in real-time
    useEffect(() => {
        let activeClient = supabase;
        let leadsChannel: any = null;
        let isMounted = true;

        const setupLeadsSubscription = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!isMounted) return;
            activeClient = session ? supabase : anonClient;

            leadsChannel = activeClient
                .channel('global:leads_changes')
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'leads'
                    },
                    () => {
                        if (isMounted) {
                            fetchLeads();
                        }
                    }
                )
                .subscribe();
        };

        setupLeadsSubscription();

        return () => {
            isMounted = false;
            if (leadsChannel) {
                activeClient.removeChannel(leadsChannel);
            }
        };
    }, [fetchLeads]);

    // Fetch messages and subscribe to realtime updates when selected contact changes
    useEffect(() => {
        if (!selectedContact) return;

        const targetIds = (selectedContact as any).leadIds || [selectedContact.id];
        let channel: any = null;
        let activeClient = supabase;
        let isMounted = true;

        const fetchMessagesAndSubscribe = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!isMounted) return;
                activeClient = session ? supabase : anonClient;

                console.log('[WhatsApp Debug] fetchMessages initiating for targetIds:', targetIds, 'selectedContact:', selectedContact);
                const { data, error } = await activeClient
                    .from('whatsapp_messages')
                    .select('*')
                    .in('lead_id', targetIds)
                    .order('created_at', { ascending: true });
                if (!isMounted) return;
                console.log('[WhatsApp Debug] fetchMessages result:', { count: data?.length, error });
                if (!error && data) {
                    setDbError(false);
                    setMessages(data.map((m: any) => ({
                        id: m.id,
                        content: m.content,
                        sender: m.sender as 'user' | 'contact',
                        timestamp: new Date(m.created_at),
                        status: m.status as MessageStatus,
                        errorMessage: m.error_message ?? null,
                    })));
                } else if (error) {
                    console.warn('Error querying whatsapp messages:', error.message);
                    if (error.code === 'PGRST205') {
                        setDbError(true);
                    }
                }

                // Subscribe to all incoming/outgoing messages in real-time to update the sidebar dynamically
                channel = activeClient
                    .channel('global:whatsapp_messages')
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'whatsapp_messages'
                        },
                        (payload) => {
                            if (!isMounted) return;
                            const eventType = payload.eventType;
                            
                            if (eventType === 'INSERT') {
                                const newMessage = payload.new;
                                // Update last message mapping dynamically for sidebar preview and sorting
                                setLastMessages(prev => ({
                                    ...prev,
                                    [newMessage.lead_id]: {
                                        content: newMessage.content,
                                        created_at: newMessage.created_at
                                    }
                                }));

                                // If the new message is for the currently active phone number group, append it
                                if (targetIds.includes(newMessage.lead_id)) {
                                    setMessages(prev => {
                                        if (prev.some(m => m.id === newMessage.id)) return prev;
                                        return [...prev, {
                                            id: newMessage.id,
                                            content: newMessage.content,
                                            sender: newMessage.sender as 'user' | 'contact',
                                            timestamp: new Date(newMessage.created_at),
                                            status: newMessage.status as MessageStatus,
                                            errorMessage: newMessage.error_message ?? null,
                                        }];
                                    });
                                }
                            } else if (eventType === 'DELETE') {
                                const oldMessage = payload.old;
                                setMessages(prev => prev.filter(m => m.id !== oldMessage.id));
                                fetchLastMessages(); // Refresh sidebar preview
                            } else if (eventType === 'UPDATE') {
                                const updatedMessage = payload.new;
                                if (targetIds.includes(updatedMessage.lead_id)) {
                                    setMessages(prev => prev.map(m => m.id === updatedMessage.id ? {
                                        ...m,
                                        content: updatedMessage.content,
                                        status: updatedMessage.status as MessageStatus,
                                        errorMessage: updatedMessage.error_message ?? null,
                                    } : m));
                                }
                                fetchLastMessages(); // Refresh sidebar preview
                            }
                        }
                    )
                    .subscribe();

            } catch (e) {
                if (isMounted) {
                    console.error(e);
                    setDbError(true);
                }
            }
        };

        fetchMessagesAndSubscribe();

        return () => {
            isMounted = false;
            if (channel) {
                activeClient.removeChannel(channel);
            }
        };
    }, [selectedContact?.phone, (selectedContact as any)?.leadIds?.join(',')]);

    // Auto-scroll to bottom of messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !selectedContact) return;

        const currentMsg = messageInput;
        setMessageInput('');

        try {
            if (editingMessageId) {
                const idToUpdate = editingMessageId;
                setEditingMessageId(null);
                await updateWhatsAppMessage(idToUpdate, currentMsg);
            } else {
                if ((selectedContact as any).source === 'WhatsApp Group') {
                    // 1. Log group message in Supabase whatsapp_messages table
                    const { error: dbErr } = await supabase.from('whatsapp_messages').insert([{
                        lead_id: selectedContact.id,
                        sender: 'user',
                        content: currentMsg,
                        status: 'sent'
                    }]);
                    if (dbErr) throw dbErr;

                    // 2. Broadcast message to all group members
                    let memberIds: string[] = [];
                    try {
                        const parsed = JSON.parse((selectedContact as any).notes || '{"members":[]}');
                        memberIds = parsed.members || [];
                    } catch (err) {}

                    const groupMembers = contacts.filter(c => memberIds.includes(c.id) && c.source !== 'WhatsApp Group');
                    if (groupMembers.length > 0) {
                        toast.info(`Broadcasting message to ${groupMembers.length} group members...`);
                        groupMembers.forEach(async (member) => {
                            try {
                                await sendWhatsApp(member.id, member.phone, currentMsg);
                            } catch (err) {
                                console.error(`Group broadcast failed for ${member.name}:`, err);
                            }
                        });
                    }
                } else {
                    await sendWhatsApp(selectedContact.id, selectedContact.phone, currentMsg);
                }
            }
        } catch (error) {
            console.error("Failed to handle WhatsApp message operation:", error);
            if (error instanceof WhatsAppSessionWindowError) {
                setMessageInput(currentMsg);
                setIsTemplatePickerOpen(true);
            }
        }
    };

    const handleForwardMessage = async () => {
        if (!forwardContent.trim() || selectedContactsForForward.length === 0) return;

        try {
            const targets = contacts.filter(c => selectedContactsForForward.includes(c.id));
            toast.info(`Forwarding message to ${targets.length} contacts...`);
            
            for (const target of targets) {
                try {
                    await sendWhatsApp(target.id, target.phone, forwardContent);
                } catch (err) {
                    console.error(`Failed to forward message to ${target.name}:`, err);
                }
            }
            
            toast.success(`Message forwarded successfully.`);
            setIsForwardOpen(false);
            setSelectedContactsForForward([]);
            setForwardContent('');
        } catch (error) {
            console.error("Failed to forward message:", error);
            toast.error("Forwarding failed");
        }
    };

    // Filter contacts based on search input
    const filteredContacts = contacts.filter(contact =>
        contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.phone.includes(searchTerm)
    );

    return (
        <div className="flex h-[calc(100vh-8rem)] min-h-[500px] bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm animate-in fade-in duration-500">
            {/* Sidebar */}
            <div className="w-80 border-r border-slate-200 flex flex-col bg-slate-50 flex-shrink-0">
                <div className="p-4 border-b border-slate-200 bg-white flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="font-black text-xs uppercase tracking-widest text-slate-400">Chats</span>
                        {!isBroadcastMode ? (
                            <div className="flex gap-1.5">
                                <button
                                    onClick={() => navigate('/leads', {
                                        state: selectedContact ? {
                                            openAdd: true,
                                            presetSource: 'WhatsApp',
                                            presetPhone: selectedContact.phone,
                                            presetName: selectedContact.name,
                                        } : { openAdd: true, presetSource: 'WhatsApp' },
                                    })}
                                    title="Create a lead from this WhatsApp conversation"
                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-[#33A894] hover:text-[#2c9180] hover:bg-emerald-50 border border-emerald-100 transition-colors"
                                >
                                    <Plus className="h-3 w-3" />
                                    Lead
                                </button>
                                <button
                                    onClick={() => syncTwilioMessages(true)}
                                    title="Sync messages from Twilio"
                                    className="flex items-center justify-center p-1.5 rounded-lg text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border border-indigo-100 transition-colors"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={() => {
                                        setIsNewGroupOpen(true);
                                        setNewGroupName('');
                                        setSelectedGroupMembers([]);
                                    }}
                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border border-emerald-100 transition-colors"
                                >
                                    <Plus className="h-3 w-3" />
                                    Group
                                </button>
                                <button
                                    onClick={() => {
                                        setIsBroadcastMode(true);
                                        setSelectedContactsForBroadcast([]);
                                        setIsBroadcastConfirmOpen(false);
                                    }}
                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border border-indigo-100 transition-colors"
                                >
                                    <Users className="h-3 w-3" />
                                    Broadcast
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-1.5">
                                <button
                                    onClick={() => {
                                        if (selectedContactsForBroadcast.length === filteredContacts.length) {
                                            setSelectedContactsForBroadcast([]);
                                        } else {
                                            setSelectedContactsForBroadcast(filteredContacts.map(c => c.id));
                                        }
                                    }}
                                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors border border-indigo-100"
                                >
                                    {selectedContactsForBroadcast.length === filteredContacts.length ? 'None' : 'All'}
                                </button>
                                <button
                                    onClick={() => {
                                        setIsBroadcastMode(false);
                                        setSelectedContactsForBroadcast([]);
                                        setIsBroadcastConfirmOpen(false);
                                    }}
                                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100 transition-colors border border-slate-200"
                                >
                                    Cancel
                                </button>
                                <button
                                    disabled={selectedContactsForBroadcast.length === 0}
                                    onClick={() => {
                                        setIsBroadcastConfirmOpen(true);
                                    }}
                                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next ({selectedContactsForBroadcast.length})
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <Input 
                            placeholder="Search chats" 
                            className="pl-9 bg-slate-100 border-none font-medium h-9 text-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <ScrollArea className="flex-1">
                    <div className="flex flex-col">
                        {filteredContacts.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm">
                                No active chats
                            </div>
                        ) : (
                            filteredContacts.map((contact) => (
                                <button
                                    key={contact.id}
                                    className={cn(
                                        "flex items-center gap-3 p-4 hover:bg-slate-100 transition-colors text-left border-b border-slate-100/50 w-full",
                                        selectedContact?.id === contact.id && !isBroadcastMode ? "bg-slate-100" : "",
                                        isBroadcastMode && selectedContactsForBroadcast.includes(contact.id) ? "bg-indigo-50/30" : ""
                                    )}
                                    onClick={() => {
                                        if (isBroadcastMode) {
                                            setSelectedContactsForBroadcast(prev => 
                                                prev.includes(contact.id)
                                                    ? prev.filter(id => id !== contact.id)
                                                    : [...prev, contact.id]
                                            );
                                        } else {
                                            setSelectedContact(contact);
                                        }
                                    }}
                                >
                                    {isBroadcastMode && (
                                        <input
                                            type="checkbox"
                                            checked={selectedContactsForBroadcast.includes(contact.id)}
                                            onChange={() => {}} // handled by onClick
                                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer flex-shrink-0"
                                        />
                                    )}
                                    <div className="relative flex-shrink-0">
                                        <Avatar className="h-12 w-12 border border-slate-200 shadow-sm">
                                            <AvatarImage src={contact.avatar} />
                                            <AvatarFallback>{contact.name[0]}</AvatarFallback>
                                        </Avatar>
                                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <div className="flex justify-between items-baseline mb-1">
                                            <span className="font-semibold text-slate-900 truncate block">{contact.name}</span>
                                            <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap ml-1">
                                                {format(contact.lastMessageTime, 'h:mm a')}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center relative group/msg">
                                            <p className="text-xs text-slate-500 truncate flex-1 mr-2 font-medium">
                                                {contact.lastMessage}
                                            </p>
                                            {unreadByPhone[digitsOnly(contact.phone)] && (
                                                <span className="flex-shrink-0 h-4.5 min-w-[18px] px-1 rounded-full bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center">
                                                    {unreadByPhone[digitsOnly(contact.phone)].count}
                                                </span>
                                            )}
                                            {!isBroadcastMode && (
                                                <div className="opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity absolute right-0 bg-gradient-to-l from-slate-50 hover:from-slate-100 pl-4 h-full flex items-center">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <button 
                                                                className="text-slate-400 hover:text-slate-600 p-0.5 rounded-lg hover:bg-slate-200/50"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <MoreVertical className="h-3.5 w-3.5" />
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="bg-white rounded-xl shadow-lg border border-slate-200 p-1 min-w-[130px] z-50">
                                                            {contact.source === 'WhatsApp Group' ? (
                                                                <>
                                                                    <DropdownMenuItem 
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedContact(contact);
                                                                            setIsEditGroupOpen(true);
                                                                        }}
                                                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer font-bold text-[11px]"
                                                                    >
                                                                        <Users className="h-3.5 w-3.5 text-indigo-500" />
                                                                        <span>Manage Members</span>
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem 
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedContact(contact);
                                                                            setIsDeleteContactOpen(true);
                                                                        }}
                                                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-700 cursor-pointer font-bold text-[11px]"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                        <span>Delete Group</span>
                                                                    </DropdownMenuItem>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <DropdownMenuItem 
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedContact(contact);
                                                                            setEditContactName(contact.name);
                                                                            setEditContactPhone(contact.phone);
                                                                            const primaryLead = leads.find(l => l.id === contact.id);
                                                                            setEditContactEmail(primaryLead?.email || '');
                                                                            setIsEditContactOpen(true);
                                                                        }}
                                                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer font-bold text-[11px]"
                                                                    >
                                                                        <Edit className="h-3.5 w-3.5 text-indigo-500" />
                                                                        <span>Edit / Rename</span>
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem 
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedContact(contact);
                                                                            setIsDeleteContactOpen(true);
                                                                        }}
                                                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-700 cursor-pointer font-bold text-[11px]"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                        <span>Delete Contact</span>
                                                                    </DropdownMenuItem>
                                                                </>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col bg-[#efeae2]/15 relative min-w-0">
                {/* Chat Background Pattern Opacity Overlay */}
                <div className="absolute inset-0 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] opacity-[0.03] pointer-events-none" />

                {/* Database Error Banner */}
                {dbError && (
                    <div className="bg-amber-50 border-b border-amber-200/60 p-3 text-amber-800 text-xs font-semibold flex items-center gap-3 px-6 z-20">
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                        <span>Database table `whatsapp_messages` is missing. Please run `supabase_schema.sql` in your Supabase SQL Editor.</span>
                    </div>
                )}

                {isBroadcastConfirmOpen ? (
                    <div className="flex-1 flex flex-col bg-white z-10 overflow-y-auto relative">
                        {/* Chat Header */}
                        <div className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-indigo-100 rounded-2xl flex items-center justify-center">
                                    <Users className="h-5 w-5 text-indigo-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Compose Broadcast Message</h3>
                                    <p className="text-xs text-slate-500 font-semibold">
                                        Sending to {selectedContactsForBroadcast.length} selected contacts
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsBroadcastConfirmOpen(false)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors border border-slate-200"
                            >
                                Back to Selection
                            </button>
                        </div>

                        {/* Composer Form */}
                        <div className="flex-1 p-6 space-y-6 max-w-2xl mx-auto w-full">
                            {/* Selected Contacts Pills */}
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recipients</Label>
                                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200/50">
                                    {leads
                                        .filter(l => selectedContactsForBroadcast.includes(l.id))
                                        .map(l => (
                                            <span key={l.id} className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                                {l.name}
                                            </span>
                                        ))
                                    }
                                </div>
                            </div>

                            {/* Tabs Selector */}
                            <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl">
                                <button
                                    type="button"
                                    onClick={() => setUseBroadcastTemplate(false)}
                                    className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                                        !useBroadcastTemplate 
                                            ? 'bg-white text-slate-800 shadow-sm' 
                                            : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    Chat Message
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setUseBroadcastTemplate(true)}
                                    className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                                        useBroadcastTemplate 
                                            ? 'bg-indigo-600 text-white shadow-sm' 
                                            : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    Meta/Twilio Template
                                </button>
                            </div>

                            <div className="space-y-6">
                                {!useBroadcastTemplate ? (
                                    <>
                                        <div className="space-y-2">
                                            <div className="flex flex-col gap-1">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-amber-600">Sandbox Pre-approved Templates</Label>
                                                <span className="text-[9px] font-medium text-amber-500/80 leading-none">Use these to contact new numbers that haven't messaged you first</span>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2">
                                                {sandboxTemplates.map((msg, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => setBroadcastMessage(msg)}
                                                        className="text-left p-2.5 rounded-xl border border-amber-100 bg-amber-50/20 hover:bg-amber-50 hover:border-amber-300 transition-all text-xs font-bold text-slate-600 hover:text-amber-800"
                                                    >
                                                        {msg}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex flex-col gap-1">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Custom CRM Templates</Label>
                                                <span className="text-[9px] font-medium text-slate-400 leading-none">Only works if the leads messaged you in the last 24 hours</span>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2">
                                                {suggestedMessages.map((msg, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => setBroadcastMessage(msg)}
                                                        className="text-left p-2.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-indigo-50 hover:border-indigo-200 transition-all text-xs font-bold text-slate-600 hover:text-indigo-700"
                                                    >
                                                        {msg}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="broadcast-message" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Message</Label>
                                            <Textarea
                                                id="broadcast-message"
                                                placeholder="Type your message here..."
                                                className="min-h-[120px] rounded-2xl border-slate-200 focus:ring-indigo-500 focus:border-indigo-500 font-bold text-slate-700"
                                                value={broadcastMessage}
                                                onChange={(e) => setBroadcastMessage(e.target.value)}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Select Approved Template</Label>
                                            <div className="grid grid-cols-1 gap-2">
                                                {approvedTemplates.map((t, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => {
                                                            setBroadcastTemplateSid(t.sid);
                                                            setBroadcastMessage(t.body);
                                                        }}
                                                        className={`text-left p-2.5 rounded-xl border transition-all text-xs font-bold ${
                                                            broadcastTemplateSid === t.sid
                                                                ? 'border-indigo-500 bg-indigo-50/50 text-indigo-800'
                                                                : 'border-slate-100 bg-slate-50/50 text-slate-600 hover:bg-slate-50'
                                                        }`}
                                                    >
                                                        <div className="font-black text-slate-800 text-[11px] mb-1">{t.name}</div>
                                                        <div className="text-[10px] text-slate-500 font-medium leading-relaxed">{t.body}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex flex-col gap-1">
                                                <Label htmlFor="broadcast-template-vars" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Template Variables</Label>
                                                <span className="text-[9px] font-medium text-slate-400 leading-none">Comma-separated values for variables, e.g. "John" for welcome name</span>
                                            </div>
                                            <Input
                                                id="broadcast-template-vars"
                                                placeholder="e.g. John"
                                                className="rounded-xl border-slate-200 focus:ring-indigo-500 focus:border-indigo-500 font-bold text-slate-700"
                                                value={broadcastTemplateVars}
                                                onChange={(e) => setBroadcastTemplateVars(e.target.value)}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3 pt-4 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsBroadcastMode(false);
                                        setSelectedContactsForBroadcast([]);
                                        setIsBroadcastConfirmOpen(false);
                                    }}
                                    className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-colors border border-slate-200 rounded-2xl font-bold"
                                >
                                    Cancel Broadcast
                                </button>
                                <button
                                    type="button"
                                    disabled={isSendingBroadcast || (useBroadcastTemplate ? !broadcastTemplateSid.trim() : !broadcastMessage.trim())}
                                    onClick={handleSendBroadcast}
                                    className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-2xl flex items-center justify-center gap-2 font-bold"
                                >
                                    {isSendingBroadcast ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        `Send to ${selectedContactsForBroadcast.length} Leads`
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : selectedContact ? (
                    <>
                        {/* Chat Header */}
                        <div className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 z-10">
                            <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10 border border-slate-200 shadow-sm">
                                    <AvatarImage src={selectedContact.avatar} />
                                    <AvatarFallback>{selectedContact.name[0]}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="font-semibold text-slate-900 leading-snug">{selectedContact.name}</h3>
                                    <p className="text-[10px] text-slate-500 font-bold leading-none mt-0.5">
                                        {(selectedContact as any).source === 'WhatsApp Group' ? (
                                            `WhatsApp Group • ${JSON.parse((selectedContact as any).notes || '{"members":[]}').members?.length || 0} participants`
                                        ) : (
                                            `WhatsApp • ${selectedContact.phone}`
                                        )}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {(selectedContact as any).source === 'WhatsApp Group' && (
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="text-slate-500 hover:bg-slate-50 rounded-xl"
                                        onClick={() => setIsEditGroupOpen(true)}
                                        title="Manage Group Members"
                                    >
                                        <Users className="h-5 w-5 text-indigo-600" />
                                    </Button>
                                )}
                                {isSearchActive ? (
                                    <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-2.5 py-1 border border-slate-200/50">
                                        <input
                                            type="text"
                                            placeholder="Search messages..."
                                            className="bg-transparent text-xs font-semibold focus:outline-none w-32 md:w-48 text-slate-700 placeholder-slate-400"
                                            value={messageSearchQuery}
                                            onChange={(e) => setMessageSearchQuery(e.target.value)}
                                            autoFocus
                                        />
                                        <button onClick={() => { setIsSearchActive(false); setMessageSearchQuery(''); }} className="text-slate-400 hover:text-slate-600">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ) : (
                                    <Button variant="ghost" size="icon" className="text-slate-500 hover:bg-slate-50 rounded-xl" onClick={() => setIsSearchActive(true)}>
                                        <Search className="h-5 w-5" />
                                    </Button>
                                )}
                                
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-slate-500 hover:bg-slate-50 rounded-xl">
                                            <MoreVertical className="h-5 w-5" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="bg-white rounded-xl shadow-lg border border-slate-200 p-1 min-w-[150px] z-50">
                                        {(selectedContact as any).source === 'WhatsApp Group' ? (
                                            <>
                                                <DropdownMenuItem 
                                                    onClick={() => setIsEditGroupOpen(true)}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer font-bold text-xs"
                                                >
                                                    <Users className="h-4 w-4 text-indigo-500" />
                                                    <span>Manage Members</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem 
                                                    onClick={() => setIsDeleteContactOpen(true)}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-700 cursor-pointer font-bold text-xs"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    <span>Delete Group</span>
                                                </DropdownMenuItem>
                                            </>
                                        ) : (
                                            <>
                                                <DropdownMenuItem 
                                                    onClick={() => {
                                                        setEditContactName(selectedContact.name);
                                                        setEditContactPhone(selectedContact.phone);
                                                        // Fetch the primary lead to populate email
                                                        const primaryLead = leads.find(l => l.id === selectedContact.id);
                                                        setEditContactEmail(primaryLead?.email || '');
                                                        setIsEditContactOpen(true);
                                                    }}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer font-bold text-xs"
                                                >
                                                    <Edit className="h-4 w-4 text-indigo-500" />
                                                    <span>Edit / Rename</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem 
                                                    onClick={() => setIsDeleteContactOpen(true)}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-700 cursor-pointer font-bold text-xs"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    <span>Delete Contact</span>
                                                </DropdownMenuItem>
                                            </>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>


                                {/* Messages List */}
                                <ScrollArea className="flex-1 p-6 z-10">
                            <div className="space-y-4">
                                {messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-[300px] text-slate-400 text-center px-4">
                                        <div className="h-12 w-12 bg-emerald-100/50 rounded-2xl flex items-center justify-center mb-3">
                                            <Send className="h-5 w-5 text-emerald-600" />
                                        </div>
                                        <p className="text-sm font-semibold text-slate-700">No Messages Yet</p>
                                        <p className="text-xs text-slate-400 mt-1 max-w-[280px]">Start the chat with this lead using the message input below.</p>
                                    </div>
                                ) : (
                                    messages.map((message) => {
                                        const isUser = message.sender === 'user';
                                        const matchesSearch = messageSearchQuery && message.content.toLowerCase().includes(messageSearchQuery.toLowerCase());
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
                                                            : "bg-white text-slate-900 rounded-tl-none",
                                                        matchesSearch ? "ring-2 ring-indigo-500/80 bg-indigo-50/20" : ""
                                                    )}
                                                >
                                                    {/* Hover Toolbar Actions */}
                                                    <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/90 backdrop-blur-md px-1.5 py-0.5 rounded-lg shadow-md border border-slate-200/50 flex items-center gap-1.5 z-20">
                                                        {isUser && !isImage && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingMessageId(message.id);
                                                                    setMessageInput(message.content);
                                                                }}
                                                                title="Edit Message"
                                                                className="text-slate-500 hover:text-slate-800 transition-colors p-0.5"
                                                            >
                                                                <Edit className="h-3 w-3" />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setForwardContent(message.content);
                                                                setSelectedContactsForForward([]);
                                                                setForwardSearchTerm('');
                                                                setIsForwardOpen(true);
                                                            }}
                                                            title="Forward Message"
                                                            className="text-slate-500 hover:text-indigo-600 transition-colors p-0.5"
                                                        >
                                                            <Forward className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                if (window.confirm("Are you sure you want to delete this message?")) {
                                                                    try {
                                                                        await deleteWhatsAppMessage(message.id);
                                                                        setMessages(prev => prev.filter(m => m.id !== message.id));
                                                                    } catch (err) {
                                                                        console.error(err);
                                                                    }
                                                                }
                                                            }}
                                                            title="Delete Message"
                                                            className="text-slate-500 hover:text-rose-600 transition-colors p-0.5"
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </button>
                                                    </div>

                                                    {isImage ? (
                                                        <div className="my-1">
                                                            <img
                                                                src={message.content}
                                                                alt="Attachment"
                                                                className="max-h-64 max-w-full rounded-lg object-contain border border-slate-200 bg-slate-50 cursor-pointer hover:opacity-95 transition-opacity"
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
                                                            <span
                                                                className={cn(
                                                                    message.status === 'read' ? "text-[#53bdeb]" :
                                                                    (message.status === 'failed' || message.status === 'undelivered') ? "text-rose-500" :
                                                                    "text-slate-400"
                                                                )}
                                                                title={message.status === 'failed' || message.status === 'undelivered' ? (message.errorMessage || 'Message failed to deliver') : undefined}
                                                            >
                                                                {message.status === 'failed' || message.status === 'undelivered' ? (
                                                                    <AlertTriangle className="h-3.5 w-3.5" />
                                                                ) : message.status === 'queued' || message.status === 'sending' ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : message.status === 'sent' ? (
                                                                    <Check className="h-3.5 w-3.5" />
                                                                ) : (
                                                                    <CheckCheck className="h-3.5 w-3.5" />
                                                                )}
                                                            </span>
                                                        )}
                                                        {isUser && (message.status === 'failed' || message.status === 'undelivered') && (
                                                            <span className="text-rose-500">Failed</span>
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

                        {/* Input Area */}
                        <div className="p-4 bg-white border-t border-slate-200 z-10 relative">
                            {/* 24h Session Window Banner — WhatsApp requires an approved template outside this window */}
                            {windowStatus && !windowStatus.withinWindow && (
                                <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-xl mb-2.5">
                                    <div className="flex items-center gap-1.5">
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                        <span>
                                            {windowStatus.lastInboundAt
                                                ? 'The 24-hour WhatsApp window has closed. Send an approved template to message this contact again.'
                                                : 'No inbound message yet — an approved template is required to start this conversation.'}
                                        </span>
                                    </div>
                                    <Button type="button" size="sm" className="h-7 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px]" onClick={() => setIsTemplatePickerOpen(true)}>
                                        Send Template
                                    </Button>
                                </div>
                            )}
                            {/* Editing Message Banner */}
                            {editingMessageId && (
                                <div className="flex items-center justify-between px-4 py-1.5 bg-indigo-50 border border-indigo-100/50 text-indigo-800 text-xs font-semibold rounded-xl mb-2.5 animate-in slide-in-from-bottom duration-200">
                                    <div className="flex items-center gap-1.5">
                                        <Edit className="h-3.5 w-3.5 text-indigo-600 animate-pulse" />
                                        <span>Editing message...</span>
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setEditingMessageId(null);
                                            setMessageInput('');
                                        }}
                                        className="text-slate-400 hover:text-indigo-900 transition-colors p-0.5"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                            {/* Emoji Picker Popover */}
                            {isEmojiOpen && (
                                <div className="absolute bottom-16 left-4 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-30 w-72 max-h-60 overflow-y-auto animate-in slide-in-from-bottom duration-200">
                                    <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Select Emoji</span>
                                        <button onClick={() => setIsEmojiOpen(false)} className="text-slate-400 hover:text-slate-600">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-8 gap-1.5 justify-items-center">
                                        {emojis.map((emoji, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                onClick={() => handleEmojiClick(emoji)}
                                                className="text-xl hover:scale-125 transition-transform p-0.5 active:scale-90"
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Hidden file input for attachments */}
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
                                    onClick={handleAttachmentClick}
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
                                        messageInput.trim() ? "bg-green-600 hover:bg-green-700 text-white shadow-md shadow-green-500/10" : "bg-slate-100 text-slate-400"
                                    )}
                                >
                                    <Send className="h-5 w-5" />
                                </Button>
                            </form>
                        </div>
                    </>
        ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                        <div className="h-16 w-16 bg-slate-100 rounded-3xl flex items-center justify-center mb-4">
                            <AlertTriangle className="h-8 w-8 text-slate-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-700">No Chats Available</h3>
                        <p className="text-sm mt-1 max-w-[280px] text-center">Add a lead with a valid phone number to start chatting via WhatsApp.</p>
                    </div>
                )}
            </div>

            <WhatsAppLeadInfoPanel leadId={selectedContact?.id ?? null} />

            {/* New Group Dialog */}
            <Dialog open={isNewGroupOpen} onOpenChange={setIsNewGroupOpen}>
                <DialogContent className="sm:max-w-[460px] bg-white rounded-2xl border-slate-200 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black text-slate-800 uppercase tracking-tight">Create New WhatsApp Group</DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium text-xs">
                            Create a group list to chat and broadcast messages to multiple contacts simultaneously.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="group-name" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Group Name</Label>
                            <Input
                                id="group-name"
                                placeholder="Enter group name..."
                                className="rounded-xl border-slate-200 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 font-bold text-slate-700"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Select Group Members</Label>
                            <ScrollArea className="h-[180px] rounded-xl border border-slate-200 p-2 bg-slate-50">
                                <div className="space-y-1">
                                    {contacts
                                        .filter(c => (c as any).source !== 'WhatsApp Group')
                                        .map((contact) => (
                                            <button
                                                key={contact.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedGroupMembers(prev => 
                                                        prev.includes(contact.id)
                                                            ? prev.filter(id => id !== contact.id)
                                                            : [...prev, contact.id]
                                                    );
                                                }}
                                                className={cn(
                                                    "flex items-center gap-3 p-2.5 hover:bg-slate-100/80 rounded-lg text-left w-full transition-colors",
                                                    selectedGroupMembers.includes(contact.id) ? "bg-indigo-50/50" : ""
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedGroupMembers.includes(contact.id)}
                                                    onChange={() => {}}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                />
                                                <div className="relative">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={contact.avatar} />
                                                        <AvatarFallback className="text-xs font-bold">{contact.name[0]}</AvatarFallback>
                                                    </Avatar>
                                                </div>
                                                <div className="flex-1 overflow-hidden">
                                                    <span className="text-xs font-bold text-slate-800 truncate block">{contact.name}</span>
                                                    <span className="text-[9px] text-slate-400 font-bold block">{contact.phone}</span>
                                                </div>
                                            </button>
                                        ))
                                    }
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setIsNewGroupOpen(false)} className="rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancel</Button>
                        <Button 
                            disabled={!newGroupName.trim() || selectedGroupMembers.length === 0} 
                            onClick={handleCreateGroup}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-5"
                        >
                            Create Group
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Group Dialog */}
            <Dialog open={isEditGroupOpen} onOpenChange={setIsEditGroupOpen}>
                <DialogContent className="sm:max-w-[460px] bg-white rounded-2xl border-slate-200 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black text-slate-800 uppercase tracking-tight">Manage Group Members</DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium text-xs">
                            Add or remove members from this group list.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-group-name" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Group Name</Label>
                            <Input
                                id="edit-group-name"
                                placeholder="Group name..."
                                className="rounded-xl border-slate-200 focus-visible:ring-indigo-500 font-bold text-slate-700"
                                value={editGroupName}
                                onChange={(e) => setEditGroupName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Group Members</Label>
                            <ScrollArea className="h-[180px] rounded-xl border border-slate-200 p-2 bg-slate-50">
                                <div className="space-y-1">
                                    {contacts
                                        .filter(c => (c as any).source !== 'WhatsApp Group')
                                        .map((contact) => (
                                            <button
                                                key={contact.id}
                                                type="button"
                                                onClick={() => {
                                                    setEditGroupMembers(prev => 
                                                        prev.includes(contact.id)
                                                            ? prev.filter(id => id !== contact.id)
                                                            : [...prev, contact.id]
                                                    );
                                                }}
                                                className={cn(
                                                    "flex items-center gap-3 p-2.5 hover:bg-slate-100/80 rounded-lg text-left w-full transition-colors",
                                                    editGroupMembers.includes(contact.id) ? "bg-indigo-50/50" : ""
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={editGroupMembers.includes(contact.id)}
                                                    onChange={() => {}}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                />
                                                <div className="relative">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={contact.avatar} />
                                                        <AvatarFallback className="text-xs font-bold">{contact.name[0]}</AvatarFallback>
                                                    </Avatar>
                                                </div>
                                                <div className="flex-1 overflow-hidden">
                                                    <span className="text-xs font-bold text-slate-800 truncate block">{contact.name}</span>
                                                    <span className="text-[9px] text-slate-400 font-bold block">{contact.phone}</span>
                                                </div>
                                            </button>
                                        ))
                                    }
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setIsEditGroupOpen(false)} className="rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancel</Button>
                        <Button 
                            disabled={!editGroupName.trim() || editGroupMembers.length === 0} 
                            onClick={handleUpdateGroup}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-5"
                        >
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Forward Message Dialog */}
            <Dialog open={isForwardOpen} onOpenChange={setIsForwardOpen}>
                <DialogContent className="sm:max-w-[460px] bg-white rounded-2xl border-slate-200 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black text-slate-800 uppercase tracking-tight">Forward Message</DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium text-xs">
                            Select one or more contacts to forward this message to.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl max-h-24 overflow-y-auto text-xs font-semibold text-slate-600 leading-relaxed italic">
                            "{forwardContent}"
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <Input 
                                placeholder="Search contacts..." 
                                className="pl-9 bg-slate-100 border-none font-medium h-9 text-xs rounded-xl"
                                value={forwardSearchTerm}
                                onChange={(e) => setForwardSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Select Contacts</Label>
                            <ScrollArea className="h-[180px] rounded-xl border border-slate-200 p-2 bg-slate-50">
                                <div className="space-y-1">
                                    {contacts
                                        .filter(c => 
                                            (c as any).source !== 'WhatsApp Group' && 
                                            (c.name.toLowerCase().includes(forwardSearchTerm.toLowerCase()) || c.phone.includes(forwardSearchTerm))
                                        )
                                        .map((contact) => (
                                            <button
                                                key={contact.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedContactsForForward(prev => 
                                                        prev.includes(contact.id)
                                                            ? prev.filter(id => id !== contact.id)
                                                            : [...prev, contact.id]
                                                    );
                                                }}
                                                className={cn(
                                                    "flex items-center gap-3 p-2.5 hover:bg-slate-100/80 rounded-lg text-left w-full transition-colors",
                                                    selectedContactsForForward.includes(contact.id) ? "bg-indigo-50/50" : ""
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedContactsForForward.includes(contact.id)}
                                                    onChange={() => {}}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                />
                                                <div className="relative">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={contact.avatar} />
                                                        <AvatarFallback className="text-xs font-bold">{contact.name[0]}</AvatarFallback>
                                                    </Avatar>
                                                </div>
                                                <div className="flex-1 overflow-hidden">
                                                    <span className="text-xs font-bold text-slate-800 truncate block">{contact.name}</span>
                                                    <span className="text-[9px] text-slate-400 font-bold block">{contact.phone}</span>
                                                </div>
                                            </button>
                                        ))
                                    }
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setIsForwardOpen(false)} className="rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancel</Button>
                        <Button 
                            disabled={selectedContactsForForward.length === 0} 
                            onClick={handleForwardMessage}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-5"
                        >
                            Forward ({selectedContactsForForward.length})
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit / Rename Contact Dialog */}
            <Dialog open={isEditContactOpen} onOpenChange={setIsEditContactOpen}>
                <DialogContent className="sm:max-w-[460px] bg-white rounded-2xl border-slate-200 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black text-slate-800 uppercase tracking-tight">Edit Contact Details</DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium text-xs">
                            Update contact name, phone, or email. This will synchronize across all records for this contact.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-contact-name" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Full Name</Label>
                            <Input
                                id="edit-contact-name"
                                placeholder="Contact name..."
                                className="rounded-xl border-slate-200 focus-visible:ring-indigo-500 font-bold text-slate-700 h-10 text-xs"
                                value={editContactName}
                                onChange={(e) => setEditContactName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-contact-phone" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Phone Number</Label>
                            <Input
                                id="edit-contact-phone"
                                placeholder="Phone number..."
                                className="rounded-xl border-slate-200 focus-visible:ring-indigo-500 font-bold text-slate-700 h-10 text-xs"
                                value={editContactPhone}
                                onChange={(e) => setEditContactPhone(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-contact-email" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email Address (Optional)</Label>
                            <Input
                                id="edit-contact-email"
                                type="email"
                                placeholder="Email address..."
                                className="rounded-xl border-slate-200 focus-visible:ring-indigo-500 font-bold text-slate-700 h-10 text-xs"
                                value={editContactEmail}
                                onChange={(e) => setEditContactEmail(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setIsEditContactOpen(false)} className="rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancel</Button>
                        <Button 
                            disabled={!editContactName.trim() || !editContactPhone.trim() || isUpdatingContact} 
                            onClick={handleUpdateContact}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-5"
                        >
                            {isUpdatingContact ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    Saving...
                                </>
                            ) : (
                                'Save Changes'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Contact Dialog */}
            <Dialog open={isDeleteContactOpen} onOpenChange={setIsDeleteContactOpen}>
                <DialogContent className="sm:max-w-[420px] bg-white rounded-2xl border-slate-200 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                            <AlertTriangle className="h-5.5 w-5.5 text-red-500 animate-bounce" />
                            <span>Confirm Deletion</span>
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium text-xs leading-relaxed">
                            Are you sure you want to delete <strong>{selectedContact?.name}</strong>?
                            <br />
                            This contact will be removed from your active list, but all past WhatsApp chat history will be fully preserved in the database.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 mt-4">
                        <Button variant="ghost" onClick={() => setIsDeleteContactOpen(false)} className="rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancel</Button>
                        <Button 
                            disabled={isDeletingContact} 
                            onClick={handleDeleteContact}
                            className="bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold px-5"
                        >
                            {isDeletingContact ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Template Picker — required to (re)open a chat outside the 24h session window */}
            <Dialog open={isTemplatePickerOpen} onOpenChange={setIsTemplatePickerOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Send Approved Template</DialogTitle>
                        <DialogDescription>
                            WhatsApp requires an approved template to message a contact outside the 24-hour session window.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        {templates.length === 0 ? (
                            <p className="text-xs text-slate-400">No active templates configured. Ask an admin to add one in WhatsApp Settings.</p>
                        ) : (
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {templates.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => setTemplatePickerSid(t.twilio_content_sid)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-xl border text-xs font-semibold transition-colors",
                                            templatePickerSid === t.twilio_content_sid ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 hover:bg-slate-50 text-slate-700"
                                        )}
                                    >
                                        <div>{t.name}</div>
                                        {t.body_preview && <div className="text-[10px] text-slate-400 font-medium truncate">{t.body_preview}</div>}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div>
                            <Label htmlFor="template-picker-vars" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Template Variables (comma separated)</Label>
                            <Input
                                id="template-picker-vars"
                                value={templatePickerVars}
                                onChange={(e) => setTemplatePickerVars(e.target.value)}
                                placeholder="e.g. John, Bali Package"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsTemplatePickerOpen(false)}>Cancel</Button>
                        <Button type="button" disabled={!templatePickerSid || isSendingTemplate} onClick={handleSendTemplate}>
                            {isSendingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Template'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
