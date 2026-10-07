import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceRepository } from './finance.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';
import { PushModule } from '../../common/push/push.module';
import { TwilioModule } from '../integrations/whatsapp/twilio.module';

@Module({
  imports: [PushModule, TwilioModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceRepository, BranchAccessService],
})
export class FinanceModule {}
