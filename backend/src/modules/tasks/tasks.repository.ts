import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

export interface TaskListParams {
  branchId?: string;
  status?: string;
  assignedTo?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class TasksRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: TaskListParams) {
    const conditions: string[] = ['is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`status = $${values.length}`);
    }
    if (params.assignedTo) {
      values.push(params.assignedTo);
      conditions.push(`assigned_to = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT * FROM tasks ${where} ORDER BY due_date ASC NULLS LAST, created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(`SELECT COUNT(*)::int AS total FROM tasks ${where}`, countValues);
    return { data: rows, total: countRows[0].total };
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tasks WHERE id = $1 AND is_deleted = false`, [id]);
    return rows[0] || null;
  }

  async create(dto: CreateTaskDto, createdBy: string | null) {
    const { rows } = await this.pool.query(
      `INSERT INTO tasks (title, description, related_type, related_id, assigned_to, due_date, priority, status, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        dto.title,
        dto.description ?? null,
        dto.relatedType ?? null,
        dto.relatedId ?? null,
        dto.assignedTo ?? null,
        dto.dueDate ?? null,
        dto.priority ?? 'medium',
        dto.status ?? 'open',
        dto.branchId,
        createdBy,
      ],
    );
    return rows[0];
  }

  async update(id: string, dto: UpdateTaskDto) {
    const fieldMap: Record<string, any> = {
      title: dto.title,
      description: dto.description,
      related_type: dto.relatedType,
      related_id: dto.relatedId,
      assigned_to: dto.assignedTo,
      due_date: dto.dueDate,
      priority: dto.priority,
      status: dto.status,
      branch_id: dto.branchId,
    };
    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) return this.findOne(id);

    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false RETURNING *`,
      values,
    );
    return rows[0] || null;
  }

  async softDelete(id: string) {
    const { rows } = await this.pool.query(`UPDATE tasks SET is_deleted = true WHERE id = $1 RETURNING id`, [id]);
    return rows[0] || null;
  }
}
