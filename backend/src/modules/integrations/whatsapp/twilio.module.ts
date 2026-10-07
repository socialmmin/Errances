import { Module } from '@nestjs/common';
import { TwilioWhatsAppService } from './twilio-whatsapp.service';
import { WaMediaController } from './wa-media.controller';
import { R2Module } from '../../../common/r2/r2.module';

// WhatsApp through Twilio, on its own so the finance, quotation and report modules can send
// WhatsApp messages and templates without depending on the WhatsApp bot.
@Module({
  imports: [R2Module],
  controllers: [WaMediaController],
  providers: [TwilioWhatsAppService],
  exports: [TwilioWhatsAppService],
})
export class TwilioModule {}
