import { Controller, Get, Param } from '@nestjs/common';
import { QuotationsService } from './quotations.service';

// No auth guards -- this is the customer-facing link shared via WhatsApp.
// Access is scoped by the unguessable public_share_token, not a session.
@Controller('quotations/public')
export class PublicQuotationsController {
  constructor(private quotationsService: QuotationsService) {}

  @Get(':token')
  findByToken(@Param('token') token: string) {
    return this.quotationsService.findByShareToken(token);
  }
}
