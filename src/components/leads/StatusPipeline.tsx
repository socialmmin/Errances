import { useState } from 'react';
import { Check, ChevronDown, Settings, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { statusBadgeClass } from '@/lib/leadUtils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function StatusPipeline({
    value,
    onChange,
    isAdmin,
}: {
    value: string;
    onChange: (statusKey: string) => void;
    isAdmin?: boolean;
}) {
    const { leadStatuses, saveLeadStatus, deleteLeadStatus } = useAppStore();
    const [manageOpen, setManageOpen] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [newLabel, setNewLabel] = useState('');

    const openStatuses = leadStatuses.filter((s) => !s.is_closed_won && !s.is_closed_lost);
    const closedStatuses = leadStatuses.filter((s) => s.is_closed_won || s.is_closed_lost);
    const currentIndex = openStatuses.findIndex((s) => s.key === value);
    const currentClosed = closedStatuses.find((s) => s.key === value);

    return (
        <div className="bg-white/60 backdrop-blur-sm p-6 rounded-3xl border border-white/80 shadow-sm shadow-indigo-900/5 flex flex-col gap-4">
            <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sales Pipeline Stage</span>
                <div className="flex items-center gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1.5 text-xs font-black text-slate-500 uppercase tracking-wider bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5">
                                Mark as Lost / Junk <ChevronDown className="h-3 w-3" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {closedStatuses.map((s) => (
                                <DropdownMenuItem key={s.key} onClick={() => onChange(s.key)}>{s.label}</DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {isAdmin && (
                        <button onClick={() => setManageOpen(true)} className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-slate-100" title="Manage pipeline statuses">
                            <Settings className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {currentClosed ? (
                <div className={cn('rounded-2xl border px-4 py-3 text-center font-black text-xs uppercase tracking-widest', statusBadgeClass(currentClosed.color))}>
                    {currentClosed.label}
                </div>
            ) : (
                <div className="relative flex items-center justify-between w-full mt-2 overflow-x-auto pb-1">
                    <div className="absolute left-0 right-0 h-1 bg-slate-200 z-0 rounded" />
                    <div
                        className="absolute left-0 h-1 bg-gradient-to-r from-emerald-400 to-indigo-500 z-0 rounded transition-all duration-500"
                        style={{ width: `${openStatuses.length > 1 ? (Math.max(currentIndex, 0) / (openStatuses.length - 1)) * 100 : 0}%` }}
                    />
                    {openStatuses.map((s, idx) => {
                        const isActive = idx <= currentIndex;
                        const isCurrent = idx === currentIndex;
                        return (
                            <button
                                key={s.key}
                                onClick={() => onChange(s.key)}
                                className="flex flex-col items-center z-10 flex-shrink-0 px-2"
                                title={`Move to ${s.label}`}
                            >
                                <div className={cn(
                                    'h-7 w-7 rounded-full flex items-center justify-center transition-all duration-300 font-bold text-xs shadow-md border-2',
                                    isCurrent ? 'bg-indigo-600 border-white text-white scale-125 ring-4 ring-indigo-100' :
                                        isActive ? 'bg-emerald-500 border-white text-white' :
                                            'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'
                                )}>
                                    {isActive ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                                </div>
                                <span className={cn('text-[9px] font-black uppercase tracking-widest mt-2 hidden sm:block whitespace-nowrap', isActive ? 'text-slate-800' : 'text-slate-400')}>
                                    {s.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Manage Pipeline Statuses</DialogTitle></DialogHeader>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                        {leadStatuses.map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-100">
                                <span className={cn('text-xs font-bold px-2 py-1 rounded-lg border', statusBadgeClass(s.color))}>{s.label}</span>
                                <button onClick={() => deleteLeadStatus(s.id)} className="text-slate-300 hover:text-red-500">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <DropdownMenuSeparator />
                    <div className="flex gap-2 items-end pt-2">
                        <div className="flex-1">
                            <label className="text-[10px] font-black uppercase text-slate-400">Key</label>
                            <Input value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))} placeholder="e.g. site_visit" />
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] font-black uppercase text-slate-400">Label</label>
                            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Site Visit" />
                        </div>
                        <Button
                            size="sm"
                            onClick={async () => {
                                if (!newKey || !newLabel) return;
                                await saveLeadStatus({ key: newKey, label: newLabel, color: 'indigo', sort_order: leadStatuses.length, is_closed_won: false, is_closed_lost: false });
                                setNewKey(''); setNewLabel('');
                            }}
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
