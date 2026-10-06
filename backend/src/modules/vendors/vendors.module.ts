import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorBookController } from './vendor-book.controller';
import { VendorsService } from './vendors.service';
import { VendorsRepository } from './vendors.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@Module({
  controllers: [VendorBookController, VendorsController],
  providers: [VendorsService, VendorsRepository, BranchAccessService],
})
export class VendorsModule {}
