import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { MetaCapiService } from './meta-capi.service';
import { LeadsModule } from '../../leads/leads.module';
import { RealtimeModule } from '../../../common/realtime/realtime.module';
import { WhatsAppBotModule } from '../whatsapp/whatsapp-bot.module';
import { PushModule } from '../../../common/push/push.module';
import { R2Module } from '../../../common/r2/r2.module';
import { ConnectionsHealthController } from './connections-health.controller';

@Module({
  imports: [LeadsModule, RealtimeModule, WhatsAppBotModule, PushModule, R2Module],
  controllers: [MetaController, ConnectionsHealthController],
  providers: [MetaService, MetaCapiService],
  exports: [MetaService, MetaCapiService],
})
export class MetaModule {}
