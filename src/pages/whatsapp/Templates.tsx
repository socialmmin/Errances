import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
    RefreshCw, Plus, Search, MessageSquare, Clock, CheckCircle2, XCircle, PauseCircle, Ban,
    FileEdit, Send, Trash2, RotateCw, Smartphone,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import {
    getWhatsAppTemplates, syncWhatsAppTemplates, createWhatsAppTemplate,
    submitWhatsAppTemplate, refreshWhatsAppTemplateStatus, setWhatsAppTemplateActive, deleteWhatsAppTemplate,
} from '@/lib/api';
import type { WhatsAppTemplate, WhatsAppTemplateStatus } from '@/types';

const STATUS_CONFIG: Record<WhatsAppTemplateStatus, { label: string; className: string; icon: any }> = {
    draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600 border-slate-200', icon: FileEdit },
    pending: { label: 'Pending Review', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
    approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
    rejected: { label: 'Rejected', className: 'bg-rose-50 text-rose-700 border-rose-200', icon: XCircle },
    paused: { label: 'Paused', className: 'bg-orange-50 text-orange-700 border-orange-200', icon: PauseCircle },
    disabled: { label: 'Disabled', className: 'bg-slate-100 text-slate-500 border-slate-200', icon: Ban },
};

const CATEGORIES = ['utility', 'marketing', 'authentication'];

function extractVariables(body: string): string[] {
    const matches = body.match(/\{\{\s*\d+\s*\}\}/g) || [];
    return Array.from(new Set(matches.map((m) => m.replace(/\D/g, ''))));
}

export function Templates() {
    const { user } = useAuth();
    const canManage = user?.role === 'admin' || user?.role === 'sales_manager';

    const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [form, setForm] = useState({
        name: '', language: 'en', category: 'utility', body: '', headerText: '', footerText: '',
        buttonType: 'none' as 'none' | 'quick_reply' | 'call_to_action',
    });
    const [buttons, setButtons] = useState<Array<{ type: string; title: string; url?: string; phone?: string }>>([]);
    const [sampleValues, setSampleValues] = useState<Record<string, string>>({});

    const [submitTarget, setSubmitTarget] = useState<WhatsAppTemplate | null>(null);
    const [submitCategory, setSubmitCategory] = useState('utility');
    const [refreshingId, setRefreshingId] = useState<string | null>(null);

    const loadTemplates = async () => {
        try {
            const { data } = await getWhatsAppTemplates();
            setTemplates(data || []);
        } catch (err: any) {
            toast.error(err.message || 'Failed to load templates');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadTemplates(); }, []);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await syncWhatsAppTemplates();
            toast.success(`Synced ${result.synced} template(s) from Twilio`);
            loadTemplates();
        } catch (err: any) {
            toast.error(err.message || 'Failed to sync templates');
        } finally {
            setSyncing(false);
        }
    };

    const detectedVars = useMemo(() => extractVariables(form.body), [form.body]);

    const resetCreateForm = () => {
        setForm({ name: '', language: 'en', category: 'utility', body: '', headerText: '', footerText: '', buttonType: 'none' });
        setButtons([]);
        setSampleValues({});
    };

    const handleCreate = async () => {
        if (!form.name.trim() || !form.body.trim()) {
            toast.error('Name and body are required');
            return;
        }
        setIsSaving(true);
        try {
            await createWhatsAppTemplate({
                name: form.name.trim(),
                language: form.language,
                category: form.category,
                body: form.body,
                headerText: form.headerText || undefined,
                footerText: form.footerText || undefined,
                buttonType: form.buttonType,
                buttons: form.buttonType !== 'none' ? buttons : undefined,
                sampleValues,
            });
            toast.success('Template created as a draft on Twilio — submit it for approval when ready');
            setIsCreateOpen(false);
            resetCreateForm();
            loadTemplates();
        } catch (err: any) {
            toast.error(err.message || 'Failed to create template');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmitForApproval = async () => {
        if (!submitTarget) return;
        setIsSaving(true);
        try {
            await submitWhatsAppTemplate(submitTarget.id, submitCategory);
            toast.success('Submitted to WhatsApp for review');
            setSubmitTarget(null);
            loadTemplates();
        } catch (err: any) {
            toast.error(err.message || 'Failed to submit for approval');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRefreshStatus = async (t: WhatsAppTemplate) => {
        setRefreshingId(t.id);
        try {
            await refreshWhatsAppTemplateStatus(t.id);
            loadTemplates();
        } catch (err: any) {
            toast.error(err.message || 'Failed to refresh status');
        } finally {
            setRefreshingId(null);
        }
    };

    const handleToggleActive = async (t: WhatsAppTemplate) => {
        try {
            await setWhatsAppTemplateActive(t.id, !t.is_active);
            loadTemplates();
        } catch (err: any) {
            toast.error(err.message || 'Failed to update template');
        }
    };

    const handleDelete = async (t: WhatsAppTemplate) => {
        if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
        try {
            await deleteWhatsAppTemplate(t.id);
            toast.success('Template deleted');
            loadTemplates();
        } catch (err: any) {
            toast.error(err.message || 'Failed to delete template');
        }
    };

    const filtered = templates.filter((t) => {
        const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.twilio_content_sid.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (loading) {
        return <div className="flex items-center justify-center h-64 text-slate-400 text-sm font-bold">Loading templates...</div>;
    }

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl font-black text-slate-900">WhatsApp Templates</h1>
                    <p className="text-xs text-slate-400 font-semibold mt-0.5">Create, sync, and track approval status for WhatsApp message templates.</p>
                </div>
                {canManage && (
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', syncing && 'animate-spin')} /> Sync from Twilio
                        </Button>
                        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Template
                        </Button>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search templates..." className="pl-8 h-9" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-44 text-xs font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => <SelectItem key={key} value={key}>{cfg.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            {filtered.length === 0 ? (
                <Card><CardContent className="py-16 text-center">
                    <MessageSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-400">No templates found.</p>
                    {canManage && <p className="text-xs text-slate-400 mt-1">Create one, or sync existing templates already approved in Twilio.</p>}
                </CardContent></Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filtered.map((t) => {
                        const cfg = STATUS_CONFIG[t.status];
                        const StatusIcon = cfg.icon;
                        return (
                            <Card key={t.id}>
                                <CardContent className="p-4 space-y-2.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-800 truncate">{t.name}</p>
                                            <p className="text-[10px] text-slate-400 font-mono truncate">{t.twilio_content_sid}</p>
                                        </div>
                                        <Badge className={cn('text-[9px] font-black border gap-1 flex-shrink-0', cfg.className)}>
                                            <StatusIcon className="h-3 w-3" /> {cfg.label}
                                        </Badge>
                                    </div>

                                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                        {t.body_preview || '(no preview)'}
                                    </p>

                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <Badge variant="outline" className="text-[9px] font-bold capitalize">{t.category}</Badge>
                                        <Badge variant="outline" className="text-[9px] font-bold uppercase">{t.language}</Badge>
                                        {!t.is_active && <Badge variant="outline" className="text-[9px] font-bold text-slate-400">Inactive</Badge>}
                                    </div>

                                    {t.status === 'rejected' && t.rejection_reason && (
                                        <p className="text-[10px] text-rose-600 font-semibold bg-rose-50 border border-rose-100 rounded-lg p-2">
                                            Rejected: {t.rejection_reason}
                                        </p>
                                    )}

                                    {canManage && (
                                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                            {(t.status === 'draft' || t.status === 'rejected') && (
                                                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { setSubmitTarget(t); setSubmitCategory(t.category); }}>
                                                    <Send className="h-3 w-3 mr-1" /> Submit for Approval
                                                </Button>
                                            )}
                                            {t.status === 'pending' && (
                                                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleRefreshStatus(t)} disabled={refreshingId === t.id}>
                                                    <RotateCw className={cn('h-3 w-3 mr-1', refreshingId === t.id && 'animate-spin')} /> Refresh Status
                                                </Button>
                                            )}
                                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleToggleActive(t)}>
                                                {t.is_active ? 'Deactivate' : 'Activate'}
                                            </Button>
                                            {t.status !== 'approved' && (
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500 hover:bg-rose-50" onClick={() => handleDelete(t)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Create Template */}
            <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetCreateForm(); }}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Create WhatsApp Template</DialogTitle>
                        <DialogDescription>Creates a Content resource on Twilio as a draft. Submitting for approval is a separate step.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Name</Label>
                                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="order_confirmation" className="mt-1" />
                                </div>
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Language</Label>
                                    <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="en" className="mt-1" />
                                </div>
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Category</Label>
                                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                    <SelectTrigger className="mt-1 h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Header (optional)</Label>
                                <Input value={form.headerText} onChange={(e) => setForm({ ...form, headerText: e.target.value })} className="mt-1" />
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Body</Label>
                                <Textarea
                                    value={form.body}
                                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                                    placeholder="Hi {{1}}, your booking for {{2}} is confirmed."
                                    className="mt-1 min-h-[100px] text-sm"
                                />
                                <p className="text-[10px] text-slate-400 font-semibold mt-1">Use {'{{1}}'}, {'{{2}}'}... for dynamic variables.</p>
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Footer (optional)</Label>
                                <Input value={form.footerText} onChange={(e) => setForm({ ...form, footerText: e.target.value })} className="mt-1" />
                            </div>

                            {detectedVars.length > 0 && (
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sample Values</Label>
                                    <div className="space-y-1.5 mt-1">
                                        {detectedVars.map((v) => (
                                            <div key={v} className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold text-slate-400 w-10 flex-shrink-0">{'{{' + v + '}}'}</span>
                                                <Input
                                                    value={sampleValues[v] || ''}
                                                    onChange={(e) => setSampleValues({ ...sampleValues, [v]: e.target.value })}
                                                    placeholder={`Sample value for variable ${v}`}
                                                    className="h-8 text-xs"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Buttons</Label>
                                <Select value={form.buttonType} onValueChange={(v: any) => { setForm({ ...form, buttonType: v }); setButtons([]); }}>
                                    <SelectTrigger className="mt-1 h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No Buttons</SelectItem>
                                        <SelectItem value="quick_reply">Quick Reply (up to 3)</SelectItem>
                                        <SelectItem value="call_to_action">Call to Action (URL / Phone, up to 2)</SelectItem>
                                    </SelectContent>
                                </Select>
                                {form.buttonType !== 'none' && (
                                    <div className="space-y-1.5 mt-2">
                                        {buttons.map((b, i) => (
                                            <div key={i} className="flex items-center gap-1.5">
                                                <Input
                                                    value={b.title}
                                                    onChange={(e) => setButtons(buttons.map((btn, idx) => idx === i ? { ...btn, title: e.target.value } : btn))}
                                                    placeholder="Button label"
                                                    className="h-8 text-xs flex-1"
                                                />
                                                {form.buttonType === 'call_to_action' && (
                                                    <>
                                                        <Select value={b.type} onValueChange={(v) => setButtons(buttons.map((btn, idx) => idx === i ? { ...btn, type: v } : btn))}>
                                                            <SelectTrigger className="h-8 w-24 text-[10px] font-bold"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="url">URL</SelectItem>
                                                                <SelectItem value="phone">Phone</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <Input
                                                            value={b.type === 'phone' ? (b.phone || '') : (b.url || '')}
                                                            onChange={(e) => setButtons(buttons.map((btn, idx) => idx === i ? { ...btn, [b.type === 'phone' ? 'phone' : 'url']: e.target.value } : btn))}
                                                            placeholder={b.type === 'phone' ? '+1415...' : 'https://...'}
                                                            className="h-8 text-xs flex-1"
                                                        />
                                                    </>
                                                )}
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500" onClick={() => setButtons(buttons.filter((_, idx) => idx !== i))}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        ))}
                                        {buttons.length < (form.buttonType === 'quick_reply' ? 3 : 2) && (
                                            <Button
                                                size="sm" variant="outline" className="h-7 text-[10px]"
                                                onClick={() => setButtons([...buttons, { type: 'url', title: '' }])}
                                            >
                                                <Plus className="h-3 w-3 mr-1" /> Add Button
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Live preview */}
                        <div className="bg-[#e5ddd5] rounded-2xl p-4 flex flex-col">
                            <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                                <Smartphone className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Live Preview</span>
                            </div>
                            <div className="bg-white rounded-lg rounded-tl-none shadow-sm p-3 max-w-[280px] space-y-1.5">
                                {form.headerText && <p className="text-xs font-black text-slate-800">{form.headerText}</p>}
                                <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                                    {(form.body || 'Your message body will appear here.').replace(/\{\{(\d+)\}\}/g, (_, n) => sampleValues[n] || `{{${n}}}`)}
                                </p>
                                {form.footerText && <p className="text-[10px] text-slate-400">{form.footerText}</p>}
                                {form.buttonType !== 'none' && buttons.length > 0 && (
                                    <div className="pt-1.5 border-t border-slate-100 space-y-1">
                                        {buttons.map((b, i) => (
                                            <p key={i} className="text-xs text-center text-[#00a5f4] font-semibold py-1">{b.title || 'Button'}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={isSaving}>{isSaving ? 'Creating...' : 'Create Draft'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Submit for approval */}
            <Dialog open={!!submitTarget} onOpenChange={(open) => !open && setSubmitTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Submit for WhatsApp Approval</DialogTitle>
                        <DialogDescription>
                            Confirm the category for "{submitTarget?.name}". Once approved, its content cannot be edited — a new version requires a new template.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Category</Label>
                        <Select value={submitCategory} onValueChange={setSubmitCategory}>
                            <SelectTrigger className="mt-1 h-9 text-xs font-bold"><SelectValue /></SelectTrigger>
                            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSubmitTarget(null)}>Cancel</Button>
                        <Button onClick={handleSubmitForApproval} disabled={isSaving}>{isSaving ? 'Submitting...' : 'Submit'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
