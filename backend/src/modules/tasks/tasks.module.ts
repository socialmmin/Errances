import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksRepository } from './tasks.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksRepository, BranchAccessService],
})
export class TasksModule {}
