import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceRepository } from './finance.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';
import { PushModule } from '../../common/push/push.module';

@Module({
  imports: [PushModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceRepository, BranchAccessService],
})
export class FinanceModule {}
