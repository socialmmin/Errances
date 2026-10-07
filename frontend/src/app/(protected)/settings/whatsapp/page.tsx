'use client';

import { WhatsAppProviderPanel } from '@/components/settings/whatsapp-provider-panel';
import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import {
  useWhatsAppTemplates, useCreateWhatsAppTemplate, useUpdateWhatsAppTemplate, useDeleteWhatsAppTemplate,
  useWhatsAppLogs,
} from '@/hooks/use-whatsapp';
import { WhatsAppTemplate, WHATSAPP_MERGE_VARIABLES } from '@/types/whatsapp';

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'logs', label: 'Message Logs' },
  { id: 'config', label: 'Twilio / Meta connection' },
] as const;

function TemplateDialog({ template, onClose }: { template: WhatsAppTemplate | 'new' | null; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateWhatsAppTemplate();
  const update = useUpdateWhatsAppTemplate();
  const isNew = template === 'new';
  const t = isNew ? null : (template as WhatsAppTemplate | null);
  const [name, setName] = useState(t?.name ?? '');
  const [body, setBody] = useState(t?.body_template ?? '');
  const [isActive, setIsActive] = useState(t?.is_active ?? true);

  if (!template) return null;

  async function submit() {
    if (isNew) {
      await create.mutateAsync({ name, bodyTemplate: body, isActive });
      toast('Template created', 'success');
    } else if (t) {
      await update.mutateAsync({ id: t.id, name, bodyTemplate: body, isActive });
      toast('Template updated', 'success');
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[85vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold text-navy dark:text-white">{isNew ? 'New Template' : 'Edit Template'}</h2>
          <div><Label>Name *</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Body *</Label>
            <Textarea className="mt-1" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available Variables</p>
            <div className="flex flex-wrap gap-1.5">
              {WHATSAPP_MERGE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs hover:bg-gold/20"
                  onClick={() => setBody((b) => `${b}{{${v}}}`)}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <span className="text-sm">Active</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!name.trim() || !body.trim() || create.isPending || update.isPending} onClick={submit}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TemplatesTab() {
  const { data, isLoading } = useWhatsAppTemplates();
  const remove = useDeleteWhatsAppTemplate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<WhatsAppTemplate | 'new' | null>(null);

  const templates = data?.data ?? [];

  async function onDelete(t: WhatsAppTemplate) {
    const ok = await confirm({ title: `Delete "${t.name}"?`, confirmLabel: 'Delete', variant: 'destructive' });
    if (!ok) return;
    await remove.mutateAsync(t.id);
    toast('Template deleted', 'success');
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PermissionGuard permission={PERMISSIONS.SETTINGS_BRANCHES}>
          <Button size="sm" className="gap-1.5" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New Template</Button>
        </PermissionGuard>
      </div>
      {isLoading ? <TableSkeleton /> : !templates.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-navy dark:text-white">{t.name}</p>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <PermissionGuard permission={PERMISSIONS.SETTINGS_BRANCHES}>
                      <button onClick={() => setEditing(t)} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                    </PermissionGuard>
                  </div>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{t.body_template}</p>
                <PermissionGuard permission={PERMISSIONS.SETTINGS_BRANCHES}>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDelete(t)}>Delete</Button>
                </PermissionGuard>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <TemplateDialog template={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function LogsTab() {
  const { data, isLoading } = useWhatsAppLogs();
  const logs = data?.data ?? [];
  return (
    <Card>
      <CardContent className="p-4">
        {isLoading ? <TableSkeleton /> : !logs.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No messages sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-navy text-white">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">To</th>
                  <th className="px-4 py-2 text-left font-medium">Template</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Sent At</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-4 py-2">{l.to_number}</td>
                    <td className="px-4 py-2">{l.template_name ?? '—'}</td>
                    <td className="px-4 py-2 capitalize">{l.status}</td>
                    <td className="px-4 py-2">{l.sent_at ? new Date(l.sent_at).toLocaleString('en-IN') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Which provider WhatsApp runs through (Twilio or Meta), with the switch and the Meta connection.
function ConfigTab() {
  return <WhatsAppProviderPanel />;
}

export default function SettingsWhatsAppPage() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('templates');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy dark:text-white">Settings — WhatsApp</h1>
        <p className="text-sm text-muted-foreground">Message templates, delivery logs, and API configuration</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              t.id === activeTab ? 'border-gold text-navy dark:text-gold' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'templates' && <TemplatesTab />}
      {activeTab === 'logs' && <LogsTab />}
      {activeTab === 'config' && <ConfigTab />}
    </div>
  );
}
