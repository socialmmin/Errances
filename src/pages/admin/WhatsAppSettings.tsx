import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/Toast';
import { CheckCircle2, XCircle, Copy, RefreshCw, MessageSquare, ArrowRight } from 'lucide-react';
import { getWhatsAppSettings, updateWhatsAppSettings } from '@/lib/api';
import type { WhatsAppSettings as WhatsAppSettingsType } from '@/types';

export function WhatsAppSettings() {
    const [settings, setSettings] = useState<WhatsAppSettingsType | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [businessName, setBusinessName] = useState('');
    const [sessionWindowHours, setSessionWindowHours] = useState(24);

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

    useEffect(() => {
        loadSettings();
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
                <Button variant="outline" size="sm" onClick={() => loadSettings()}>
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

            <Link to="/whatsapp/templates">
                <Card className="hover:border-slate-300 transition-colors cursor-pointer">
                    <CardContent className="flex items-center justify-between py-4">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                                <MessageSquare className="h-4 w-4 text-indigo-600" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-800">Message Templates</p>
                                <p className="text-[11px] text-slate-400 font-semibold">Create, sync, and track WhatsApp template approval status</p>
                            </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-slate-400" />
                    </CardContent>
                </Card>
            </Link>
        </div>
    );
}
