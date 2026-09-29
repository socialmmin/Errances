import { Module } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { R2Module } from '../../../common/r2/r2.module';
import { LeadsModule } from '../../leads/leads.module';
import { RealtimeModule } from '../../../common/realtime/realtime.module';
import { PackagesModule } from '../../packages/packages.module';
import { PushModule } from '../../../common/push/push.module';

@Module({
  imports: [R2Module, LeadsModule, RealtimeModule, PackagesModule, PushModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppBotService],
  exports: [WhatsAppBotService],
})
export class WhatsAppBotModule {}
