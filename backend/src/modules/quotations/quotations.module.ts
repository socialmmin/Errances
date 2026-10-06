import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { PublicQuotationsController } from './public-quotations.controller';
import { ItemSuggestionsController } from './item-suggestions.controller';
import { QuotationsService } from './quotations.service';
import { QuotationsRepository } from './quotations.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';
import { PushModule } from '../../common/push/push.module';

@Module({
  imports: [PushModule],
  controllers: [PublicQuotationsController, ItemSuggestionsController, QuotationsController],
  providers: [QuotationsService, QuotationsRepository, BranchAccessService],
})
export class QuotationsModule {}
