import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Copy, RefreshCw, Plus, Trash2, MessageSquare } from 'lucide-react';
import { getWhatsAppSettings, updateWhatsAppSettings } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { WhatsAppSettings as WhatsAppSettingsType, WhatsAppTemplate } from '@/types';

export function WhatsAppSettings() {
    const [settings, setSettings] = useState<WhatsAppSettingsType | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [businessName, setBusinessName] = useState('');
    const [sessionWindowHours, setSessionWindowHours] = useState(24);

    const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
    const [isAddingTemplate, setIsAddingTemplate] = useState(false);
    const [newTemplate, setNewTemplate] = useState({ name: '', twilio_content_sid: '', body_preview: '', category: 'utility', language: 'en' });

    const loadSettings = async () => {
        try {
            const data = await getWhatsAppSettings();
            setSettings(data);
            setBusinessName(data.settings?.business_name || '');
            setSessionWindowHours(data.settings?.session_window_hours || 24);
        } catch (err: any) {
            toast.error(err.message || 'Failed to load WhatsApp settings');
        } finally {
            setLoading(false);
        }
    };

    const loadTemplates = async () => {
        const { data, error } = await supabase.from('whatsapp_templates').select('*').order('created_at', { ascending: false });
        if (!error && data) setTemplates(data);
    };

    useEffect(() => {
        loadSettings();
        loadTemplates();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateWhatsAppSettings({ businessName, sessionWindowHours });
            toast.success('WhatsApp settings updated');
            loadSettings();
        } catch (err: any) {
            toast.error(err.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast.success(`${label} copied to clipboard`);
    };

    const handleAddTemplate = async () => {
        if (!newTemplate.name.trim() || !newTemplate.twilio_content_sid.trim()) return;
        const { error } = await supabase.from('whatsapp_templates').insert([newTemplate]);
        if (error) {
            toast.error(error.message || 'Failed to add template');
            return;
        }
        toast.success('Template added');
        setIsAddingTemplate(false);
        setNewTemplate({ name: '', twilio_content_sid: '', body_preview: '', category: 'utility', language: 'en' });
        loadTemplates();
    };

    const handleToggleTemplate = async (template: WhatsAppTemplate) => {
        const { error } = await supabase.from('whatsapp_templates').update({ is_active: !template.is_active }).eq('id', template.id);
        if (error) { toast.error('Failed to update template'); return; }
        loadTemplates();
    };

    const handleDeleteTemplate = async (id: string) => {
        if (!window.confirm('Delete this template?')) return;
        const { error } = await supabase.from('whatsapp_templates').delete().eq('id', id);
        if (error) { toast.error('Failed to delete template'); return; }
        toast.success('Template deleted');
        loadTemplates();
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64 text-slate-400 text-sm font-bold">Loading WhatsApp settings...</div>;
    }

    if (!settings) {
        return <div className="flex items-center justify-center h-64 text-slate-400 text-sm font-bold">Could not load WhatsApp settings.</div>;
    }

    return (
        <div className="space-y-5 max-w-4xl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-black text-slate-900">WhatsApp Business Settings</h1>
                    <p className="text-xs text-slate-400 font-semibold mt-0.5">Twilio connection, webhooks, and approved message templates.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { loadSettings(); loadTemplates(); }}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Connection Status</CardTitle>
                    <CardDescription>Twilio credentials are configured server-side only and are never shown here.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                        {settings.connected ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 gap-1 font-bold"><CheckCircle2 className="h-3 w-3" /> Twilio Connected</Badge>
                        ) : (
                            <Badge className="bg-rose-50 text-rose-700 border border-rose-200 gap-1 font-bold"><XCircle className="h-3 w-3" /> Twilio Not Configured</Badge>
                        )}
                        {settings.webhookConfigured ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 gap-1 font-bold"><CheckCircle2 className="h-3 w-3" /> Webhook URL Set</Badge>
                        ) : (
                            <Badge className="bg-amber-50 text-amber-700 border border-amber-200 gap-1 font-bold"><XCircle className="h-3 w-3" /> PUBLIC_URL Not Set</Badge>
                        )}
                    </div>

                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">WhatsApp Business Number</Label>
                        <p className="text-sm font-bold text-slate-800 mt-1">{settings.whatsappNumber || 'Not configured'}</p>
                    </div>

                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Incoming Message Webhook</Label>
                        <div className="flex items-center gap-2 mt-1">
                            <Input readOnly value={settings.incomingWebhookUrl || 'Set PUBLIC_URL to generate this URL'} className="text-xs font-mono" />
                            {settings.incomingWebhookUrl && (
                                <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(settings.incomingWebhookUrl!, 'Webhook URL')}>
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold mt-1">Set this as the "When a message comes in" webhook on your Twilio WhatsApp sender.</p>
                    </div>

                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status Callback Webhook</Label>
                        <div className="flex items-center gap-2 mt-1">
                            <Input readOnly value={settings.statusWebhookUrl || 'Set PUBLIC_URL to generate this URL'} className="text-xs font-mono" />
                            {settings.statusWebhookUrl && (
                                <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(settings.statusWebhookUrl!, 'Status webhook URL')}>
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold mt-1">Applied automatically to every outbound message — used for delivery/read receipts.</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Business Configuration</CardTitle>
                    <CardDescription>Applies to all agents. Only admins and sales managers can change these.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Business Name</Label>
                        <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} disabled={!settings.canManage} className="mt-1" />
                    </div>
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Session Window (hours)</Label>
                        <Input
                            type="number"
                            min={1}
                            max={72}
                            value={sessionWindowHours}
                            onChange={(e) => setSessionWindowHours(Number(e.target.value) || 24)}
                            disabled={!settings.canManage}
                            className="mt-1 w-32"
                        />
                        <p className="text-[10px] text-slate-400 font-semibold mt-1">WhatsApp's platform limit is 24 hours — do not increase beyond that.</p>
                    </div>
                    {settings.canManage && (
                        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-sm">Approved Templates</CardTitle>
                        <CardDescription>Content SIDs must already be approved in the Twilio/Meta console — this list only stores references to them.</CardDescription>
                    </div>
                    {settings.canManage && (
                        <Button size="sm" variant="outline" onClick={() => setIsAddingTemplate((v) => !v)}>
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add Template
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="space-y-3">
                    {isAddingTemplate && (
                        <div className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Name</Label>
                                    <Input value={newTemplate.name} onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })} />
                                </div>
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Twilio Content SID</Label>
                                    <Input value={newTemplate.twilio_content_sid} onChange={(e) => setNewTemplate({ ...newTemplate, twilio_content_sid: e.target.value })} placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                                </div>
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Preview Text</Label>
                                <Input value={newTemplate.body_preview} onChange={(e) => setNewTemplate({ ...newTemplate, body_preview: e.target.value })} />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => setIsAddingTemplate(false)}>Cancel</Button>
                                <Button size="sm" onClick={handleAddTemplate}>Save Template</Button>
                            </div>
                        </div>
                    )}

                    {templates.length === 0 ? (
                        <p className="text-xs text-slate-400 font-semibold py-4 text-center">No templates configured yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {templates.map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-xl p-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <MessageSquare className="h-4 w-4 text-slate-400 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-slate-800 truncate">{t.name}</p>
                                            <p className="text-[10px] text-slate-400 font-mono truncate">{t.twilio_content_sid}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <Badge className={cn('text-[9px] font-black border', t.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                                            {t.is_active ? 'Active' : 'Inactive'}
                                        </Badge>
                                        {settings.canManage && (
                                            <>
                                                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleToggleTemplate(t)}>
                                                    {t.is_active ? 'Deactivate' : 'Activate'}
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500 hover:bg-rose-50" onClick={() => handleDeleteTemplate(t.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
