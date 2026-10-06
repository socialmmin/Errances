import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { TwilioWhatsAppService } from './twilio-whatsapp.service';

// Twilio calls these for the WhatsApp sender (incoming messages, then delivery status of what we
// send). The paths are the ones the sender is configured with in the Twilio console. Every request
// must carry Twilio's signature; we answer immediately (empty TwiML) and process afterwards.
@Controller('webhooks')
export class TwilioWebhookController {
  private logger = new Logger('TwilioWebhook');

  constructor(private bot: WhatsAppBotService, private twilio: TwilioWhatsAppService) {}

  // The form fields exactly as Twilio sent (and signed) them -- read from the raw bytes so the
  // body parser's nested-key handling can never change what the signature is checked against.
  private params(req: Request): Record<string, string> {
    const raw: Buffer | undefined = (req as any).rawBody;
    if (!raw?.length) return (req.body ?? {}) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw.toString('utf-8'))) out[k] = v;
    return out;
  }

  private signed(req: Request, params: Record<string, string>) {
    const url = this.twilio.apiBase() + req.originalUrl;
    return this.twilio.validSignature(url, params, req.headers['x-twilio-signature'] as string | undefined);
  }

  @SkipThrottle()
  @Post('twilio')
  inbound(@Req() req: Request, @Res() res: Response) {
    const params = this.params(req);
    if (!this.signed(req, params)) {
      this.logger.warn(`Rejected unsigned Twilio inbound request from ${req.ip}`);
      res.status(403).send('Invalid signature');
      return;
    }
    res.type('text/xml').status(200).send('<Response></Response>');
    this.bot.processTwilioInbound(params).catch((err) => this.logger.error(`Twilio inbound processing failed: ${err.message}`, err.stack));
  }

  @SkipThrottle()
  @Post('twilio/status')
  status(@Req() req: Request, @Res() res: Response) {
    const params = this.params(req);
    if (!this.signed(req, params)) {
      res.status(403).send('Invalid signature');
      return;
    }
    res.status(204).send();
    this.bot.processTwilioStatus(params).catch((err) => this.logger.error(`Twilio status processing failed: ${err.message}`));
  }
}
