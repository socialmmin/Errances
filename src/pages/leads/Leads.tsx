import { useState, useRef, useMemo, useEffect } from 'react';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Plus, Download, Upload } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { LeadsTable } from '@/components/leads/LeadsTable';
import { useLeadFilters } from '@/components/leads/LeadFiltersBar';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { LeadForm } from '@/components/leads/LeadForm';
import { v4 as uuidv4 } from 'uuid';
import type { Lead } from '@/types';
import { KPICards } from '@/components/dashboard/KPICards';
import { useI18n } from '@/i18n';
import { WhatsAppModal } from '@/components/leads/WhatsAppModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import { getLeadRevenue } from '@/lib/utils';
import { parseCSVContent } from '@/lib/csvParser';

export function Leads() {
    const { fetchLeads, addLead, updateLead, deleteLead, tours, fetchLeadStatuses, fetchFollowups, fetchStaff } = useAppStore();
    const rawLeads = useFilteredLeads();
    const { filtered: leads, FilterBar } = useLeadFilters(rawLeads, 'leads');
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState<Lead | undefined>(undefined);
    const [whatsappLead, setWhatsappLead] = useState<Lead | null>(null);
    const [quickAddPreset, setQuickAddPreset] = useState<{ source?: string; phone?: string; name?: string; tour?: string } | null>(null);

    useEffect(() => {
        fetchLeads();
        fetchLeadStatuses();
        fetchFollowups();
        fetchStaff();
    }, [fetchLeads, fetchLeadStatuses, fetchFollowups, fetchStaff]);

    // Opened via Quick Add / "Create WhatsApp Lead" elsewhere in the app (navigate('/leads', { state: {...} }))
    useEffect(() => {
        const state = location.state as { openAdd?: boolean; presetSource?: string; presetPhone?: string; presetName?: string; presetTour?: string } | null;
        if (state?.openAdd) {
            setSelectedLead(undefined);
            setQuickAddPreset({ source: state.presetSource, phone: state.presetPhone, name: state.presetName, tour: state.presetTour });
            setIsDialogOpen(true);
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    // KPI calculation
    const kpis = useMemo(() => {
        const totalLeads = leads.length;
        const totalValue = leads.reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);
        const avgBudget = totalLeads > 0 ? Math.round(totalValue / totalLeads) : 0;

        return [
            { label: t('totalLeads'), value: totalLeads.toString(), icon: 'Users' },
            { label: t('totalValue'), value: `€${totalValue.toLocaleString()}`, icon: 'Euro' },
            { label: t('avgBudget'), value: `€${avgBudget.toLocaleString()}`, icon: 'TrendingUp' },
        ];
    }, [leads, tours, t]);

    const handleExport = () => {
        const headers = ['Lead ID', 'Name', 'Email', 'Phone', 'WhatsApp', 'DOB', 'Gender', 'Status', 'Priority', 'Source', 'Campaign', 'Budget', 'Tour Interest', 'Follow-up Date'];
        const csvContent = [
            headers.join(','),
            ...leads.map(lead => [
                lead.lead_number || '',
                `"${lead.name}"`,
                lead.email,
                lead.phone,
                lead.whatsapp_number || '',
                lead.dob || '',
                lead.gender || '',
                lead.status,
                lead.priority || '',
                lead.source,
                lead.campaign || '',
                lead.budget || '',
                `"${lead.tour_interest || ''}"`,
                lead.follow_up_date || '',
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `leads_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImportClick = () => fileInputRef.current?.click();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target?.result as string;
            try {
                const parsedEntries = parseCSVContent(content);
                if (parsedEntries.length === 0) {
                    toast.error('No valid lead entries found in CSV');
                    return;
                }

                let importedCount = 0;
                for (const item of parsedEntries) {
                    const leadName = item.name || item.phone || item.email || 'Unnamed Lead';

                    await addLead({
                        id: uuidv4(),
                        created_at: new Date().toISOString(),
                        name: leadName,
                        email: item.email || '',
                        phone: item.phone || '',
                        status: (item.status as any) || 'new',
                        source: item.source || 'CSV Import',
                        budget: item.budget || 0,
                        tour_interest: item.tour_interest || '',
                        notes: item.notes || ''
                    } as Lead);
                    importedCount++;
                }

                toast.success(`Successfully imported ${importedCount} leads`);
            } catch (error) {
                console.error('Import error:', error);
                toast.error('Failed to parse CSV file. Please ensure it has valid data.');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const handleAddLead = () => {
        setSelectedLead(undefined);
        setQuickAddPreset(null);
        setIsDialogOpen(true);
    };

    const handleEditLead = (lead: Lead) => {
        setSelectedLead(lead);
        setIsDialogOpen(true);
    };

    const handleSaveLead = (data: any) => {
        if (selectedLead) {
            updateLead(selectedLead.id, data);
        } else {
            addLead({
                id: uuidv4(),
                created_at: new Date().toISOString(),
                ...data
            });
        }
        setIsDialogOpen(false);
    };

    const handleDeleteLead = (id: string) => {
        if (window.confirm('Are you sure you want to delete this lead?')) {
            deleteLead(id);
        }
    };

    const handleBulkStatus = async (ids: string[], status: string) => {
        try {
            await supabase.from('leads').update({ status }).in('id', ids);
            toast.success(`Updated status for ${ids.length} leads`);
            fetchLeads();
        } catch {
            toast.error('Failed to bulk-update status');
        }
    };

    const handleBulkAssign = async (ids: string[], staffId: string | null) => {
        try {
            await supabase.from('leads').update({ assigned_staff_id: staffId }).in('id', ids);
            toast.success(`Assigned ${ids.length} leads`);
            fetchLeads();
        } catch {
            toast.error('Failed to bulk-assign leads');
        }
    };

    return (
        <div className="min-h-[calc(100vh-6rem)] flex flex-col gap-6 animate-in fade-in duration-500 pb-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5">
                <div>
                    <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase">{t('leads')}</h2>
                    <p className="text-slate-500 font-medium">{t('manageLeadsDesc')}</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <Button
                        className="bg-[#33A894] hover:bg-[#2c9180] text-white h-11 px-6 rounded-xl shadow-md shadow-[#33A894]/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 font-bold"
                        onClick={handleAddLead}
                    >
                        <Plus className="h-4 w-4" /> {t('addLead')}
                    </Button>
                    <div className="flex items-center bg-white/80 backdrop-blur-sm rounded-xl p-1 border border-slate-200/60 shadow-sm">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept=".csv,.json"
                            onChange={handleFileChange}
                        />
                        <Button variant="ghost" size="sm" className="h-9 px-4 text-slate-600 hover:text-indigo-600 font-bold rounded-lg transition-colors" onClick={handleImportClick}>
                            <Upload className="w-4 h-4 mr-2 opacity-70" />
                            {t('import')}
                        </Button>
                        <div className="w-px h-4 bg-slate-200/60 mx-1" />
                        <Button variant="ghost" size="sm" className="h-9 px-4 text-slate-600 hover:text-indigo-600 font-bold rounded-lg transition-colors" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2 opacity-70" />
                            {t('export')}
                        </Button>
                    </div>
                </div>
            </div>

            <KPICards kpis={kpis} />

            <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5 p-4">
                {FilterBar}
            </div>

            <div className="flex-1 mt-0">
                <LeadsTable
                    leads={leads}
                    onEdit={handleEditLead}
                    onDelete={handleDeleteLead}
                    onWhatsApp={(lead) => setWhatsappLead(lead)}
                    onBulkStatus={handleBulkStatus}
                    onBulkAssign={handleBulkAssign}
                    storageKey="leads"
                />
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{selectedLead ? t('editLeadTitle') : t('addNewLeadTitle')}</DialogTitle>
                        <DialogDescription>
                            {selectedLead ? t('editLeadDesc') : t('addNewLeadDesc')}
                        </DialogDescription>
                    </DialogHeader>
                    <LeadForm
                        initialData={selectedLead}
                        onSubmit={handleSaveLead}
                        onCancel={() => setIsDialogOpen(false)}
                        onViewExisting={(id) => { setIsDialogOpen(false); navigate(`/leads/${id}`); }}
                        presetSource={quickAddPreset?.source}
                        presetPhone={quickAddPreset?.phone}
                        presetName={quickAddPreset?.name}
                        presetTour={quickAddPreset?.tour}
                    />
                </DialogContent>
            </Dialog>

            <WhatsAppModal
                lead={whatsappLead}
                isOpen={!!whatsappLead}
                onClose={() => setWhatsappLead(null)}
            />
        </div>
    );
}
