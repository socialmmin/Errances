'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCreateTask } from '@/hooks/use-tasks';
import { TaskInput } from '@/types/task';
import { useAuthStore } from '@/store/auth-store';
import { tr } from '@/i18n';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function TaskForm({ onCreated }: { onCreated?: () => void }) {
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';

  const [form, setForm] = useState<TaskInput>({
    title: '',
    description: '',
    dueDate: '',
    priority: 'medium',
    status: 'open',
    branchId,
  });

  const createMutation = useCreateTask();

  function set<K extends keyof TaskInput>(key: K, value: TaskInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, branchId: branchId || form.branchId };
    try {
      await createMutation.mutateAsync(payload);
      toast(tr("Task created"), 'success');
      setForm({ title: '', description: '', dueDate: '', priority: 'medium', status: 'open', branchId });
      onCreated?.();
    } catch (err: any) {
      toast(err.message || tr("Failed to create task"), 'error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="space-y-1">
        <Label htmlFor="title">{tr("Task Title")}</Label>
        <Input id="title" required value={form.title} onChange={(e) => set('title', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="dueDate">{tr("Due Date")}</Label>
          <Input id="dueDate" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="priority">{tr("Priority")}</Label>
          <select id="priority" className={selectClass} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{tr(p)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">{tr("Description")}</Label>
        <textarea
          id="description"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <Button type="submit" variant="gold" disabled={createMutation.isPending}>
        {createMutation.isPending ? tr("Saving…") : tr("Add Task")}
      </Button>
    </form>
  );
}
