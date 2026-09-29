import { Injectable, NotFoundException } from '@nestjs/common';
import { TasksRepository } from './tasks.repository';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private repo: TasksRepository) {}

  findAll(params: { branchId?: string; status?: string; assignedTo?: string; page?: number; pageSize?: number }) {
    return this.repo.findAll({
      branchId: params.branchId,
      status: params.status,
      assignedTo: params.assignedTo,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  }

  async findOne(id: string) {
    const task = await this.repo.findOne(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  create(dto: CreateTaskDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateTaskDto) {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Task not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Task not found');
    return { success: true };
  }
}
