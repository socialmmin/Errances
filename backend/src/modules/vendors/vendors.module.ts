import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { VendorsRepository } from './vendors.repository';

@Module({
  controllers: [VendorsController],
  providers: [VendorsService, VendorsRepository],
})
export class VendorsModule {}
