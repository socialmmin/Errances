import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { TwilioWhatsAppService } from './twilio-whatsapp.service';

// Where Twilio fetches a document or image the CRM sends on WhatsApp (see
// TwilioWhatsAppService.mediaLink). No login: Twilio cannot sign in, and each link is a random
// id that only the message it was made for carries; links lapse after 30 days.
@Controller('wa-media')
export class WaMediaController {
  constructor(private twilio: TwilioWhatsAppService) {}

  @SkipThrottle()
  @Get(':id/:name')
  async serve(@Param('id') id: string, @Res() res: Response) {
    const file = await this.twilio.mediaFile(id);
    if (!file) throw new NotFoundException();
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(file.body);
  }
}
