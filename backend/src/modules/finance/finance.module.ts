import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceRepository } from './finance.repository';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, FinanceRepository],
})
export class FinanceModule {}
