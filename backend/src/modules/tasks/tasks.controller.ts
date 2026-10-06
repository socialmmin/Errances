import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService, private branchAccess: BranchAccessService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TASKS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Req() req?: any,
  ) {
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.tasksService.findAll({
      branchId: effectiveBranchId,
      status,
      assignedTo,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TASKS_VIEW)
  async findOne(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('tasks', id, req.user);
    return this.tasksService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TASKS_CREATE)
  create(@Body() dto: CreateTaskDto, @Req() req: any) {
    return this.tasksService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TASKS_EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Req() req: any) {
    await this.branchAccess.assertAccess('tasks', id, req.user);
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TASKS_DELETE)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('tasks', id, req.user);
    return this.tasksService.remove(id);
  }
}
