import { useState, useRef, useMemo, useEffect } from 'react';
import {
    DndContext,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
    type DragEndEvent,
    type DragStartEvent,
    type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useAppStore } from '@/store';
import { KanbanColumn } from '@/components/leads/KanbanColumn';
import { LeadCard } from '@/components/leads/LeadCard';
import { Button } from '@/components/ui/button';
import { Plus, Download, Upload } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { LeadForm } from '@/components/leads/LeadForm';
import { v4 as uuidv4 } from 'uuid';
import { parseCSVContent } from '@/lib/csvParser';
import type { Lead } from '@/types';
import { KPICards } from '@/components/dashboard/KPICards';
import { useI18n } from '@/i18n';
import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import { getLeadRevenue } from '@/lib/utils';
export function Pipeline() {
    const { fetchLeads, addLead, updateLead, tours, leadStatuses, fetchLeadStatuses } = useAppStore();
    const leads = useFilteredLeads();
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState<Lead | undefined>(undefined);
    const { t } = useI18n();

    const COLUMNS = useMemo(
        () => leadStatuses.map((s) => ({ id: s.key, title: s.label, isClosedWon: s.is_closed_won, isClosedLost: s.is_closed_lost })),
        [leadStatuses]
    );

    useEffect(() => {
        fetchLeads();
        fetchLeadStatuses();
    }, [fetchLeads, fetchLeadStatuses]);

    // Calculate KPIs
    const kpis = useMemo(() => {
        const totalLeads = leads.length;
        const convertedLeads = leads.filter(l => leadStatuses.find((s) => s.key === l.status)?.is_closed_won).length;
        const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';
        const totalRevenue = leads
            .filter(l => leadStatuses.find((s) => s.key === l.status)?.is_closed_won)
            .reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);

        return [
            { label: t('totalLeads'), value: totalLeads.toString(), icon: 'Users' },
            { label: t('convertedCol'), value: convertedLeads.toString(), icon: 'UserCheck' },
            { label: t('conversionRate'), value: `${conversionRate}%`, icon: 'TrendingUp' },
            { label: t('revenue'), value: `€${totalRevenue.toLocaleString()}`, icon: 'Euro' },
        ];
    }, [leads, t]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const getLeadsByStatus = (status: string) => {
        const filtered = leads.filter((lead) => (lead.status || '').toLowerCase().trim() === status.toLowerCase().trim());
        return filtered;
    };

    const findContainer = (id: string) => {
        if (COLUMNS.find(c => c.id === id)) {
            return id;
        }
        const lead = leads.find(l => l.id === id);
        return lead ? lead.status : null;
    };

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        setActiveId(active.id as string);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        const overId = over?.id;

        if (!overId || active.id === overId) return;
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        const activeId = active.id as string;
        const overId = over?.id as string;

        if (!overId) {
            setActiveId(null);
            return;
        }

        const activeContainer = findContainer(activeId);
        const overContainer = findContainer(overId);

        if (activeContainer && overContainer && activeContainer !== overContainer) {
            updateLead(activeId, { status: overContainer as any });
        }

        setActiveId(null);
    };

    const dropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({
            styles: {
                active: {
                    opacity: '0.5',
                },
            },
        }),
    };

    const activeLead = activeId ? leads.find(l => l.id === activeId) : null;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleExport = () => {
        const headers = ['id', 'name', 'email', 'phone', 'status', 'source', 'budget', 'tour_interest'];
        const csvContent = [
            headers.join(','),
            ...leads.map(lead => [
                lead.id,
                `"${lead.name}"`,
                lead.email,
                lead.phone,
                lead.status,
                lead.source,
                lead.budget || '',
                `"${lead.tour_interest || ''}"`
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

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

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
                    });
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

    return (
        <div className="min-h-[calc(100vh-6rem)] flex flex-col gap-6 animate-in fade-in duration-500 pb-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">{t('pipeline')}</h2>
                    <p className="text-slate-500 mt-1">{t('manageSalesPipeline')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button className="bg-[#33A894] hover:bg-[#2c9180] text-white shadow-md shadow-[#33A894]/20 transition-all hover:scale-105" onClick={handleAddLead}>
                        <Plus className="w-4 h-4 mr-2" />
                        {t('newLead')}
                    </Button>
                    <div className="flex items-center bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept=".csv,.json"
                            onChange={handleFileChange}
                        />
                        <Button variant="ghost" size="sm" className="h-8 text-slate-600 hover:text-indigo-600" onClick={handleImportClick}>
                            <Upload className="w-4 h-4 mr-2" />
                            {t('import')}
                        </Button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <Button variant="ghost" size="sm" className="h-8 text-slate-600 hover:text-indigo-600" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2" />
                            {t('export')}
                        </Button>
                    </div>
                </div>
            </div>

            <KPICards kpis={kpis} />

            <div className="flex-1 mt-0">
                <div className="relative">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="flex-1 overflow-x-auto pb-6">
                            <div className="flex gap-3 pb-2 px-1 h-full">
                                {COLUMNS.map((col) => (
                                    <div key={col.id} className="w-[260px] flex-shrink-0 h-full">
                                        <KanbanColumn
                                            id={col.id}
                                            title={col.title}
                                            leads={getLeadsByStatus(col.id)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <DragOverlay dropAnimation={dropAnimation}>
                            {activeLead ? <LeadCard lead={activeLead} /> : null}
                        </DragOverlay>
                    </DndContext>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{selectedLead ? t('edit') + ' ' + t('leads') : t('addNewLeadTitle')}</DialogTitle>
                        <DialogDescription>
                            {selectedLead ? t('addNewLeadDesc') : t('addNewLeadDesc')}
                        </DialogDescription>
                    </DialogHeader>
                    <LeadForm
                        initialData={selectedLead}
                        onSubmit={handleSaveLead}
                        onCancel={() => setIsDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
