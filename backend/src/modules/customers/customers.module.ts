import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository, BranchAccessService],
})
export class CustomersModule {}
