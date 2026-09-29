import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsRepository } from './leads.repository';
import { FollowUpsController } from './follow-ups.controller';
import { LeadNotesController } from './lead-notes.controller';
import { CallbackRequestsController } from './callback-requests.controller';
import { PushModule } from '../../common/push/push.module';

@Module({
  imports: [PushModule],
  controllers: [LeadsController, FollowUpsController, LeadNotesController, CallbackRequestsController],
  providers: [LeadsService, LeadsRepository],
  exports: [LeadsService, LeadsRepository],
})
export class LeadsModule {}
