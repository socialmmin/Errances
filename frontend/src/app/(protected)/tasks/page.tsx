'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { useTasks, useUpdateTask } from '@/hooks/use-tasks';
import { Task } from '@/types/task';
import { TaskForm } from '@/components/tasks/task-form';
import { useToast } from '@/components/ui/toast';
import { tr, locale } from '@/i18n';

const STATUS_OPTIONS = ['open', 'in_progress', 'done', 'cancelled'];

function StatusCell({ task }: { task: Task }) {
  const { toast } = useToast();
  const updateMutation = useUpdateTask(task.id);

  return (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      value={task.status}
      onChange={async (e) => {
        try {
          await updateMutation.mutateAsync({ status: e.target.value });
          toast(tr("Task updated"), 'success');
        } catch (err: any) {
          toast(err.message || tr("Failed to update task"), 'error');
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>{tr(s.replace(/_/g, ' '))}</option>
      ))}
    </select>
  );
}

const columns: ColumnDef<Task>[] = [
  { accessorKey: 'title', header: 'Title' },
  {
    accessorKey: 'due_date',
    header: 'Due',
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return v ? new Date(v).toLocaleDateString(locale()) : '—';
    },
  },
  { accessorKey: 'priority', header: 'Priority' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusCell task={row.original} />,
  },
];

export default function TasksPage() {
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, isError, error } = useTasks();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Tasks")}</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-600"
        >
          {showForm ? tr("Close") : tr("+ New Task")}
        </button>
      </div>

      {showForm && <TaskForm onCreated={() => setShowForm(false)} />}

      {isError && (
        <p className="text-sm text-red-500">
          {tr("Failed to load tasks:")}{' '}{(error as Error)?.message ?? tr("unknown error")}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        emptyMessage="No tasks yet. Create your first task to get started."
      />
    </div>
  );
}
