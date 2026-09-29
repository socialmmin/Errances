import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { PublicQuotationsController } from './public-quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationsRepository } from './quotations.repository';

@Module({
  controllers: [PublicQuotationsController, QuotationsController],
  providers: [QuotationsService, QuotationsRepository],
})
export class QuotationsModule {}
