import { Module } from '@nestjs/common';
import { TwilioWhatsAppService } from './twilio-whatsapp.service';
import { MetaWhatsAppService } from './meta-whatsapp.service';
import { WaMediaController } from './wa-media.controller';
import { R2Module } from '../../../common/r2/r2.module';

// The two ways WhatsApp can run -- through Twilio, or through Meta's own Cloud API -- on their own
// so the finance, quotation, report, settings and bulk modules can use them without depending on
// the WhatsApp bot. TwilioWhatsAppService also holds which of the two is switched on.
@Module({
  imports: [R2Module],
  controllers: [WaMediaController],
  providers: [TwilioWhatsAppService, MetaWhatsAppService],
  exports: [TwilioWhatsAppService, MetaWhatsAppService],
})
export class TwilioModule {}
