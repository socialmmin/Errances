import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Users, MessageSquare, Tags, ArrowRight } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { LeadStatusSettings } from './LeadStatusSettings';

export function Settings() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [tab, setTab] = useState('general');

    return (
        <div className="space-y-5 max-w-4xl">
            <div>
                <h1 className="text-xl font-black text-slate-900">Settings</h1>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">CRM-wide configuration for admins and sales managers.</p>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="lead-statuses">Lead Statuses</TabsTrigger>
                    <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-3 mt-4">
                    {isAdmin && (
                        <Link to="/staff">
                            <Card className="hover:border-slate-300 transition-colors cursor-pointer">
                                <CardContent className="flex items-center justify-between py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                                            <Users className="h-4 w-4 text-indigo-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">Staff &amp; Roles</p>
                                            <p className="text-[11px] text-slate-400 font-semibold">Manage staff accounts, roles, and access</p>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-slate-400" />
                                </CardContent>
                            </Card>
                        </Link>
                    )}
                    <Link to="/whatsapp/templates">
                        <Card className="hover:border-slate-300 transition-colors cursor-pointer">
                            <CardContent className="flex items-center justify-between py-4">
                                <div className="flex items-center gap-3">
                                    <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                                        <MessageSquare className="h-4 w-4 text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-slate-800">WhatsApp Templates</p>
                                        <p className="text-[11px] text-slate-400 font-semibold">Create and manage approved message templates</p>
                                    </div>
                                </div>
                                <ArrowRight className="h-4 w-4 text-slate-400" />
                            </CardContent>
                        </Card>
                    </Link>
                    <Card>
                        <CardContent className="flex items-center gap-3 py-4">
                            <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center">
                                <Tags className="h-4 w-4 text-slate-500" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-800">Lead Statuses</p>
                                <p className="text-[11px] text-slate-400 font-semibold">Configured in the "Lead Statuses" tab above</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="lead-statuses" className="mt-4">
                    <LeadStatusSettings canManage={isAdmin} />
                </TabsContent>

                <TabsContent value="whatsapp" className="mt-4">
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-sm font-bold text-slate-600">WhatsApp connection, webhooks, and business configuration moved to their own page.</p>
                            <Link to="/settings/whatsapp" className="inline-flex items-center gap-1.5 text-indigo-600 text-sm font-bold mt-3 hover:underline">
                                Open WhatsApp Settings <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
