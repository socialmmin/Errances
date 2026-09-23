import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/Toast';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { useAppStore } from '@/store';
import { statusDotClass } from '@/lib/leadUtils';
import type { LeadStatusConfig } from '@/types';

// Matches leadUtils.ts's COLOR_DOT_CLASSES/COLOR_CLASSES static Tailwind maps — Tailwind's
// build only includes classes it can see as literal strings, so colors must stay in that
// fixed set rather than being interpolated (`bg-${color}-500` would get purged in prod).
const COLOR_OPTIONS = ['slate', 'blue', 'indigo', 'emerald', 'amber', 'rose', 'red', 'teal'];

export function LeadStatusSettings({ canManage }: { canManage: boolean }) {
    const { leadStatuses, saveLeadStatus, deleteLeadStatus } = useAppStore();
    const [isOpen, setIsOpen] = useState(false);
    const [editing, setEditing] = useState<Partial<LeadStatusConfig> | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const openNew = () => {
        setEditing({ key: '', label: '', color: 'slate', sort_order: leadStatuses.length, is_closed_won: false, is_closed_lost: false });
        setIsOpen(true);
    };

    const openEdit = (status: LeadStatusConfig) => {
        setEditing({ ...status });
        setIsOpen(true);
    };

    const handleSave = async () => {
        if (!editing?.key?.trim() || !editing?.label?.trim()) {
            toast.error('Key and label are required');
            return;
        }
        setIsSaving(true);
        try {
            await saveLeadStatus(editing as any);
            setIsOpen(false);
            setEditing(null);
        } catch {
            // saveLeadStatus already surfaces a toast on failure
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (status: LeadStatusConfig) => {
        if (!window.confirm(`Delete status "${status.label}"? Leads currently using it will keep the raw key but lose its display config.`)) return;
        await deleteLeadStatus(status.id);
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400 font-semibold">Pipeline stages leads move through. Changes apply everywhere immediately.</p>
                {canManage && (
                    <Button size="sm" onClick={openNew}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Status
                    </Button>
                )}
            </div>

            <div className="space-y-2">
                {[...leadStatuses].sort((a, b) => a.sort_order - b.sort_order).map((status) => (
                    <Card key={status.id}>
                        <CardContent className="flex items-center justify-between gap-3 py-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0" />
                                <span className={`h-3 w-3 rounded-full flex-shrink-0 ${statusDotClass(status.color)}`} />
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-800 truncate">{status.label}</p>
                                    <p className="text-[10px] text-slate-400 font-mono truncate">{status.key}</p>
                                </div>
                                {status.is_closed_won && <Badge className="text-[9px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">Won</Badge>}
                                {status.is_closed_lost && <Badge className="text-[9px] font-black bg-rose-50 text-rose-700 border border-rose-200">Lost</Badge>}
                            </div>
                            {canManage && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => openEdit(status)}>Edit</Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500 hover:bg-rose-50" onClick={() => handleDelete(status)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editing?.id ? 'Edit Lead Status' : 'New Lead Status'}</DialogTitle>
                        <DialogDescription>Controls how this stage appears across Pipeline, Leads, and reports.</DialogDescription>
                    </DialogHeader>
                    {editing && (
                        <div className="space-y-3 py-2">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Key</Label>
                                    <Input
                                        value={editing.key}
                                        onChange={(e) => setEditing({ ...editing, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                        disabled={!!editing.id}
                                        placeholder="e.g. negotiation"
                                        className="mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Display Label</Label>
                                    <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className="mt-1" />
                                </div>
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Color</Label>
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                    {COLOR_OPTIONS.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setEditing({ ...editing, color: c })}
                                            className={`h-7 w-7 rounded-full ${statusDotClass(c)} ring-2 ring-offset-2 transition-all ${editing.color === c ? 'ring-slate-800' : 'ring-transparent'}`}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                    <input type="checkbox" checked={!!editing.is_closed_won} onChange={(e) => setEditing({ ...editing, is_closed_won: e.target.checked, is_closed_lost: e.target.checked ? false : editing.is_closed_lost })} />
                                    Counts as Closed Won
                                </label>
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                    <input type="checkbox" checked={!!editing.is_closed_lost} onChange={(e) => setEditing({ ...editing, is_closed_lost: e.target.checked, is_closed_won: e.target.checked ? false : editing.is_closed_won })} />
                                    Counts as Closed Lost
                                </label>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
