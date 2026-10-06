import { Module } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { TwilioWebhookController } from './twilio-webhook.controller';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { TwilioWhatsAppService } from './twilio-whatsapp.service';
import { R2Module } from '../../../common/r2/r2.module';
import { LeadsModule } from '../../leads/leads.module';
import { RealtimeModule } from '../../../common/realtime/realtime.module';
import { PackagesModule } from '../../packages/packages.module';
import { PushModule } from '../../../common/push/push.module';

@Module({
  imports: [R2Module, LeadsModule, RealtimeModule, PackagesModule, PushModule],
  controllers: [WhatsAppWebhookController, TwilioWebhookController],
  providers: [WhatsAppBotService, TwilioWhatsAppService],
  exports: [WhatsAppBotService, TwilioWhatsAppService],
})
export class WhatsAppBotModule {}
