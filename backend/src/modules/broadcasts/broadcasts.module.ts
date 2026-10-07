import { Module } from '@nestjs/common';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';
import { TwilioModule } from '../integrations/whatsapp/twilio.module';
import { R2Module } from '../../common/r2/r2.module';

@Module({
  imports: [TwilioModule, R2Module],
  controllers: [BroadcastsController],
  providers: [BroadcastsService],
})
export class BroadcastsModule {}
