import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { R2Module } from '../../common/r2/r2.module';

@Module({
  imports: [R2Module],
  controllers: [HealthController],
})
export class HealthModule {}
