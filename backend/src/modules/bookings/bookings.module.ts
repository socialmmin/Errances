import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsRepository } from './bookings.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository, BranchAccessService],
})
export class BookingsModule {}
