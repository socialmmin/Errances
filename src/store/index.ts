import { create } from 'zustand';
import type { Lead, TourPackage, User, LeadStatusConfig, LeadActivity, LeadFollowup, LeadDocument, LeadPayment, WhatsAppConversation } from '@/types';
import * as api from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/Toast';
import { DEFAULT_LEAD_STATUSES } from '@/lib/leadUtils';

interface AppState {
    user: User | null;
    leads: Lead[];
    tours: TourPackage[];
    staff: User[];
    leadStatuses: LeadStatusConfig[];
    followups: LeadFollowup[];
    conversations: WhatsAppConversation[];
    isLoading: boolean;

    setUser: (user: User | null) => void;
    fetchLeads: () => Promise<void>;
    setLeads: (leads: Lead[]) => void;
    addLead: (lead: Lead) => Promise<void>;
    updateLead: (id: string, updates: Partial<Lead>) => Promise<void>;
    deleteLead: (id: string) => Promise<void>;

    fetchLeadStatuses: () => Promise<void>;
    saveLeadStatus: (status: Partial<LeadStatusConfig> & { key: string; label: string }) => Promise<void>;
    deleteLeadStatus: (id: string) => Promise<void>;

    fetchFollowups: () => Promise<void>;
    addFollowup: (followup: Partial<LeadFollowup>) => Promise<void>;
    updateFollowup: (id: string, updates: Partial<LeadFollowup>) => Promise<void>;
    deleteFollowup: (id: string) => Promise<void>;

    fetchLeadActivities: (leadId: string) => Promise<LeadActivity[]>;
    logLeadActivity: (leadId: string, type: string, description: string, metadata?: any) => Promise<void>;

    fetchLeadDocuments: (leadId: string) => Promise<LeadDocument[]>;
    addLeadDocument: (doc: Partial<LeadDocument>) => Promise<void>;
    deleteLeadDocument: (id: string) => Promise<void>;

    fetchLeadPayments: (leadId: string) => Promise<LeadPayment[]>;
    addLeadPayment: (payment: Partial<LeadPayment>) => Promise<void>;
    deleteLeadPayment: (id: string) => Promise<void>;

    fetchConversations: () => Promise<void>;
    markConversationRead: (conversationId: string) => Promise<void>;
    assignConversation: (conversationId: string, staffId: string | null, staffName?: string) => Promise<void>;
    setConversationStatus: (conversationId: string, status: 'open' | 'pending' | 'resolved') => Promise<void>;

    fetchTours: () => Promise<void>;
    setTours: (tours: TourPackage[]) => void;
    addTour: (tour: TourPackage) => Promise<void>;
    updateTour: (id: string, updates: Partial<TourPackage>) => Promise<void>;
    deleteTour: (id: string) => Promise<void>;

    fetchStaff: () => Promise<void>;
    setStaff: (staff: User[]) => void;
    addStaff: (user: User, password?: string) => Promise<void>;
    updateStaff: (id: string, updates: Partial<User>) => Promise<void>;
    deleteStaff: (id: string) => Promise<void>;
    sendWhatsApp: (leadId: string, to: string, message: string, contentSid?: string, contentVariables?: Record<string, string>) => Promise<void>;
    deleteWhatsAppMessage: (id: string) => Promise<void>;
    updateWhatsAppMessage: (id: string, content: string) => Promise<void>;
}

// Mock Data removed


export const useAppStore = create<AppState>((set, get) => ({
    user: null,
    leads: [],
    tours: [],
    staff: [],
    leadStatuses: DEFAULT_LEAD_STATUSES,
    followups: [],
    conversations: [],
    isLoading: false,

    setUser: (user) => set({ user }),

    // Leads Actions
    fetchLeads: async () => {
        set({ isLoading: true });
        try {
            const leads = await api.getLeads();
            set({ leads, isLoading: false });
        } catch (error) {
            console.error('Failed to fetch leads:', error);
            set({ isLoading: false });
        }
    },
    setLeads: (leads) => set({ leads }),
    addLead: async (lead) => {
        set({ isLoading: true });
        try {
            if ('assigned_staff_id' in lead) {
                if (!lead.assigned_staff_id || lead.assigned_staff_id === 'unassigned' || lead.assigned_staff_id === '') {
                    lead.assigned_staff_id = null;
                }
            }

            // If assigning a staff member, first ensure they have a profile entry
            if (lead.assigned_staff_id) {
                const staffMember = get().staff.find(s => s.id === lead.assigned_staff_id);
                if (staffMember) {
                    try {
                        await supabase.from('profiles').upsert([{
                            id: staffMember.id,
                            full_name: staffMember.full_name,
                            email: staffMember.email,
                            role: staffMember.role,
                        }], { onConflict: 'id' });
                    } catch (_) {
                        // Best-effort sync
                    }
                }
            }

            const newLead = await api.createLead(lead);
            set((state) => ({
                leads: [newLead, ...state.leads],
                isLoading: false
            }));
            toast.success('Lead added successfully');
            
            // Check if today matches any birthday/travel event for the new lead
            api.triggerBirthdayWishesCheck().catch(err => console.error('Failed to trigger birthday check on lead add:', err));

            // Send welcome template via WhatsApp if phone is present and not from CSV Import
            let isContactOnly = false;
            try {
                if (newLead.notes) {
                    const parsed = JSON.parse(newLead.notes);
                    isContactOnly = parsed && parsed.is_contact === true;
                }
            } catch (_) {}

            if (newLead.phone && newLead.source !== 'CSV Import' && !isContactOnly) {
                try {
                    await get().sendWhatsApp(
                        newLead.id,
                        newLead.phone,
                        `Hello ${newLead.name}, thank you for contacting Errances Voyages! We have received your inquiry. A travel specialist will get back to you shortly. How can we help you today?`,
                        'HX2ada749a93d94f4a77cf706c63173358',
                        { '1': newLead.name }
                    );
                } catch (whatsappErr) {
                    console.error('Failed to automatically send welcome WhatsApp template:', whatsappErr);
                }
            }
        } catch (error: any) {
            console.error('Failed to add lead:', error);

            // Handle FK error for assigned_staff_id
            const isFkError = error?.code === '23503' ||
                (error?.message && error.message.includes('foreign key'));

            if (isFkError && lead.assigned_staff_id) {
                const { assigned_staff_id: _removed, ...leadWithoutStaff } = lead;
                try {
                    const newLead = await api.createLead(leadWithoutStaff);
                    set((state) => ({
                        leads: [newLead, ...state.leads],
                        isLoading: false
                    }));
                    toast.success('Lead added (staff assignment skipped — staff not yet synced)');
                    return;
                } catch (innerError) {
                    toast.error(`Failed to add lead: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`);
                }
            } else {
                toast.error(`Failed to add lead: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            set({ isLoading: false });
        }
    },
    updateLead: async (id, updates) => {
        try {
            if ('assigned_staff_id' in updates) {
                if (!updates.assigned_staff_id || updates.assigned_staff_id === 'unassigned' || updates.assigned_staff_id === '') {
                    updates.assigned_staff_id = null;
                }
            }

            // If assigning a staff member, first ensure they have a profile entry
            // (required by the leads.assigned_staff_id FK constraint on profiles table)
            if (updates.assigned_staff_id) {
                const staffMember = get().staff.find(s => s.id === updates.assigned_staff_id);
                if (staffMember) {
                    // Best-effort upsert into profiles so FK doesn't fail
                    try {
                        await supabase.from('profiles').upsert([{
                            id: staffMember.id,
                            full_name: staffMember.full_name,
                            email: staffMember.email,
                            role: staffMember.role,
                        }], { onConflict: 'id' });
                    } catch (_) {
                        // RLS may block this — we'll fall through and see if update works anyway
                    }
                }
            }

            // Optimistic update
            set((state) => ({
                leads: state.leads.map((l) => (l.id === id ? { ...l, ...updates } : l))
            }));

            try {
                await api.updateLead(id, updates);
                toast.success('Lead updated successfully');
                
                // Check if today matches any birthday/travel event for the updated lead
                api.triggerBirthdayWishesCheck().catch(err => console.error('Failed to trigger birthday check on lead update:', err));
            } catch (error: any) {
                // If FK constraint error on assigned_staff_id, save without it and notify user
                const isFkError = error?.code === '23503' ||
                    (error?.message && error.message.includes('foreign key'));
                if (isFkError && updates.assigned_staff_id) {
                    const { assigned_staff_id: _removed, ...updatesWithoutStaff } = updates;
                    await api.updateLead(id, updatesWithoutStaff);
                    toast.success('Lead updated (staff assignment skipped — staff not yet synced to authentication)');
                    get().fetchLeads();
                } else {
                    throw error;
                }
            }
        } catch (error) {
            console.error('Failed to update lead:', error);
            toast.error(`Failed to update lead: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Revert on failure
            get().fetchLeads();
        }
    },

    deleteLead: async (id) => {
        try {
            // Optimistic update
            set((state) => ({
                leads: state.leads.filter((l) => l.id !== id)
            }));
            await api.deleteLead(id);
            toast.success('Lead deleted successfully');
        } catch (error: any) {
            console.error('Failed to delete lead:', error);
            const errMsg = error?.message || error?.details || (error instanceof Error ? error.message : 'Unknown error');
            toast.error(`Failed to delete lead: ${errMsg}`);
            get().fetchLeads();
        }
    },

    // Tours Actions
    fetchTours: async () => {
        set({ isLoading: true });
        try {
            const tours = await api.getTours();
            set({ tours, isLoading: false });
        } catch (error) {
            console.error('Failed to fetch tours:', error);
            set({ isLoading: false });
        }
    },
    setTours: (tours) => set({ tours }),
    addTour: async (tour) => {
        set({ isLoading: true });
        try {
            const { id, ...tourData } = tour;
            const newTour = await api.createTour(tourData);
            set((state) => ({
                tours: [newTour, ...state.tours],
                isLoading: false
            }));
            toast.success('Tour added successfully');
        } catch (error) {
            console.error('Failed to add tour:', error);
            toast.error(`Failed to add tour: ${error instanceof Error ? error.message : 'Unknown error'}`);
            set({ isLoading: false });
        }
    },
    updateTour: async (id, updates) => {
        try {
            set((state) => ({
                tours: state.tours.map((t) => (t.id === id ? { ...t, ...updates } : t))
            }));
            await api.updateTour(id, updates);
        } catch (error) {
            console.error('Failed to update tour:', error);
            get().fetchTours();
        }
    },
    deleteTour: async (id) => {
        try {
            set((state) => ({
                tours: state.tours.filter((t) => t.id !== id)
            }));
            await api.deleteTour(id);
        } catch (error) {
            console.error('Failed to delete tour:', error);
            get().fetchTours();
        }
    },

    fetchStaff: async () => {
        console.log('Store: fetchStaff initiated');
        set({ isLoading: true });
        try {
            const staff = await api.getStaff();
            console.log('Store: fetchStaff success, data:', staff);
            set({ staff, isLoading: false });
        } catch (error) {
            console.error('Store: fetchStaff failed:', error);
            set({ isLoading: false });
        }
    },
    setStaff: (staff) => set({ staff }),
    addStaff: async (user, password) => {
        set({ isLoading: true });
        try {
            const { data: newStaff } = await api.createStaff(user, password);

            set((state) => ({
                staff: [newStaff, ...state.staff],
                isLoading: false
            }));

            toast.success('Staff member added successfully');
        } catch (error) {
            console.error('Failed to add staff:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to add staff member');
            set({ isLoading: false });
        }
    },
    updateStaff: async (id, updates) => {
        try {
            set((state) => ({
                staff: state.staff.map((s) => (s.id === id ? { ...s, ...updates } : s))
            }));
            await api.updateStaff(id, updates);
            toast.success('Staff updated successfully');
        } catch (error) {
            console.error('Failed to update staff:', error);
            toast.error('Failed to update staff');
            get().fetchStaff();
        }
    },
    deleteStaff: async (id) => {
        try {
            set((state) => ({
                staff: state.staff.filter((s) => s.id !== id),
                leads: state.leads.map((l) => (l.assigned_staff_id === id ? { ...l, assigned_staff_id: null } : l))
            }));
            await api.deleteStaff(id);
            toast.success('Staff deleted successfully');
        } catch (error: any) {
            console.error('Failed to delete staff:', error);
            const errMsg = error?.message || error?.details || (error instanceof Error ? error.message : 'Unknown error');
            toast.error(`Failed to delete staff: ${errMsg}`);
            get().fetchStaff();
            get().fetchLeads();
        }
    },
    sendWhatsApp: async (leadId, to, message, contentSid, contentVariables) => {
        try {
            const isImage = message.startsWith('data:image/');
            const twilioMessage = isImage ? '📷 Sent a photo' : message;
            const loggedContent = contentSid ? `[Template ${contentSid}] ${message}` : message;

            // Backend stores the message (with its Twilio SID) atomically with the send —
            // no separate client-side insert needed.
            await api.sendWhatsAppMessage(to, twilioMessage, leadId, contentSid, contentVariables, isImage ? loggedContent : undefined);
            toast.success('WhatsApp message sent successfully');
        } catch (error: any) {
            console.error('Failed to send WhatsApp message:', error);
            if (error?.code === 'SESSION_WINDOW_CLOSED') {
                toast.error('This chat is outside the 24-hour WhatsApp window — send an approved template to reopen it.');
            } else {
                toast.error(error.message || 'Failed to send WhatsApp message');
            }
            throw error;
        }
    },
    deleteWhatsAppMessage: async (id) => {
        try {
            await api.deleteWhatsAppMessage(id);
            toast.success('Message deleted successfully');
        } catch (error) {
            console.error('Failed to delete WhatsApp message:', error);
            toast.error('Failed to delete message');
            throw error;
        }
    },
    updateWhatsAppMessage: async (id, content) => {
        try {
            await api.updateWhatsAppMessage(id, content);
            toast.success('Message updated successfully');
        } catch (error) {
            console.error('Failed to update WhatsApp message:', error);
            toast.error('Failed to update message');
            throw error;
        }
    },

    // --- Lead pipeline configuration ---
    fetchLeadStatuses: async () => {
        try {
            const { data, error } = await supabase.from('lead_statuses').select('*').order('sort_order', { ascending: true });
            if (error) throw error;
            if (data && data.length > 0) set({ leadStatuses: data });
        } catch (error) {
            console.error('Failed to fetch lead statuses:', error);
        }
    },
    saveLeadStatus: async (status) => {
        try {
            if (status.id) {
                const { data, error } = await supabase.from('lead_statuses').update(status).eq('id', status.id).select().single();
                if (error) throw error;
                set((state) => ({ leadStatuses: state.leadStatuses.map((s) => (s.id === data.id ? data : s)) }));
            } else {
                const { data, error } = await supabase.from('lead_statuses').insert([status]).select().single();
                if (error) throw error;
                set((state) => ({ leadStatuses: [...state.leadStatuses, data].sort((a, b) => a.sort_order - b.sort_order) }));
            }
            toast.success('Status saved');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to save status');
            throw error;
        }
    },
    deleteLeadStatus: async (id) => {
        try {
            await supabase.from('lead_statuses').delete().eq('id', id);
            set((state) => ({ leadStatuses: state.leadStatuses.filter((s) => s.id !== id) }));
            toast.success('Status removed');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to remove status');
        }
    },

    // --- Follow-ups ---
    fetchFollowups: async () => {
        try {
            const { data, error } = await supabase.from('lead_followups').select('*').order('due_date', { ascending: true });
            if (error) throw error;
            set({ followups: data || [] });
        } catch (error) {
            console.error('Failed to fetch follow-ups:', error);
        }
    },
    addFollowup: async (followup) => {
        try {
            const { data, error } = await supabase.from('lead_followups').insert([followup]).select().single();
            if (error) throw error;
            set((state) => ({ followups: [...state.followups, data] }));
            if (followup.lead_id) {
                await get().logLeadActivity(followup.lead_id, 'followup', `Follow-up scheduled for ${followup.due_date}`);
            }
            toast.success('Follow-up scheduled');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to schedule follow-up');
            throw error;
        }
    },
    updateFollowup: async (id, updates) => {
        try {
            const { data, error } = await supabase.from('lead_followups').update(updates).eq('id', id).select().single();
            if (error) throw error;
            set((state) => ({ followups: state.followups.map((f) => (f.id === id ? data : f)) }));
            if (updates.status === 'done' && data.lead_id) {
                await get().logLeadActivity(data.lead_id, 'followup_done', 'Follow-up marked as done');
            }
        } catch (error: any) {
            toast.error(error?.message || 'Failed to update follow-up');
        }
    },
    deleteFollowup: async (id) => {
        try {
            await supabase.from('lead_followups').delete().eq('id', id);
            set((state) => ({ followups: state.followups.filter((f) => f.id !== id) }));
        } catch (error: any) {
            toast.error(error?.message || 'Failed to delete follow-up');
        }
    },

    // --- Activities (per-lead timeline) ---
    fetchLeadActivities: async (leadId) => {
        try {
            const { data, error } = await supabase
                .from('lead_activities')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Failed to fetch lead activities:', error);
            return [];
        }
    },
    logLeadActivity: async (leadId, type, description, metadata) => {
        try {
            await supabase.from('lead_activities').insert([{ lead_id: leadId, type, description, metadata }]);
        } catch (error) {
            console.error('Failed to log activity:', error);
        }
    },

    // --- Documents ---
    fetchLeadDocuments: async (leadId) => {
        try {
            const { data, error } = await supabase
                .from('lead_documents')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Failed to fetch documents:', error);
            return [];
        }
    },
    addLeadDocument: async (doc) => {
        try {
            const { error } = await supabase.from('lead_documents').insert([doc]);
            if (error) throw error;
            if (doc.lead_id) {
                await get().logLeadActivity(doc.lead_id, 'document', `Document uploaded: ${doc.name}`);
            }
            toast.success('Document uploaded');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to save document');
            throw error;
        }
    },
    deleteLeadDocument: async (id) => {
        try {
            await supabase.from('lead_documents').delete().eq('id', id);
            toast.success('Document removed');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to remove document');
        }
    },

    // --- Payments (manual ledger) ---
    fetchLeadPayments: async (leadId) => {
        try {
            const { data, error } = await supabase
                .from('lead_payments')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Failed to fetch payments:', error);
            return [];
        }
    },
    addLeadPayment: async (payment) => {
        try {
            const { error } = await supabase.from('lead_payments').insert([payment]);
            if (error) throw error;
            if (payment.lead_id) {
                await get().logLeadActivity(payment.lead_id, 'payment', `Payment recorded: ${payment.amount}`);
            }
            toast.success('Payment recorded');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to record payment');
            throw error;
        }
    },
    deleteLeadPayment: async (id) => {
        try {
            await supabase.from('lead_payments').delete().eq('id', id);
            toast.success('Payment removed');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to remove payment');
        }
    },

    // --- WhatsApp conversations ---
    fetchConversations: async () => {
        try {
            const { data, error } = await supabase.from('whatsapp_conversations').select('*').order('last_message_at', { ascending: false });
            if (error) throw error;
            set({ conversations: data || [] });
        } catch (error) {
            console.error('Failed to fetch WhatsApp conversations:', error);
        }
    },
    markConversationRead: async (conversationId) => {
        set((state) => ({
            conversations: state.conversations.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)),
        }));
        try {
            await api.markWhatsAppConversationRead(conversationId);
        } catch (error) {
            console.error('Failed to mark conversation read:', error);
        }
    },
    assignConversation: async (conversationId, staffId, staffName) => {
        try {
            const { data } = await api.assignWhatsAppConversation(conversationId, staffId, staffName);
            set((state) => ({
                conversations: state.conversations.map((c) => (c.id === conversationId ? data : c)),
            }));
            toast.success(staffId ? 'Conversation assigned' : 'Conversation unassigned');
        } catch (error: any) {
            toast.error(error?.message || 'Failed to assign conversation');
        }
    },
    setConversationStatus: async (conversationId, status) => {
        try {
            const { data } = await api.updateWhatsAppConversationStatus(conversationId, status);
            set((state) => ({
                conversations: state.conversations.map((c) => (c.id === conversationId ? data : c)),
            }));
            toast.success(`Conversation marked ${status}`);
        } catch (error: any) {
            toast.error(error?.message || 'Failed to update conversation status');
        }
    },
}));
