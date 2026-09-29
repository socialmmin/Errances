import { Module } from '@nestjs/common';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { PackagesRepository } from './packages.repository';
import { R2Module } from '../../common/r2/r2.module';

@Module({
  imports: [R2Module],
  controllers: [PackagesController],
  providers: [PackagesService, PackagesRepository],
  exports: [PackagesService],
})
export class PackagesModule {}
