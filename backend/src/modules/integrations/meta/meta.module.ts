import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { MetaCapiService } from './meta-capi.service';
import { LeadsModule } from '../../leads/leads.module';
import { RealtimeModule } from '../../../common/realtime/realtime.module';
import { WhatsAppBotModule } from '../whatsapp/whatsapp-bot.module';
import { PushModule } from '../../../common/push/push.module';

@Module({
  imports: [LeadsModule, RealtimeModule, WhatsAppBotModule, PushModule],
  controllers: [MetaController],
  providers: [MetaService, MetaCapiService],
  exports: [MetaService, MetaCapiService],
})
export class MetaModule {}
