export interface Task {
  id: string;
  title: string;
  description: string | null;
  related_type: string | null;
  related_id: string | null;
  assigned_to: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  branch_id: string;
  created_at: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  relatedType?: string;
  relatedId?: string;
  assignedTo?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  branchId: string;
}
