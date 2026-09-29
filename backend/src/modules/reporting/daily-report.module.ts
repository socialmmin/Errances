import { Module } from '@nestjs/common';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import { MetaModule } from '../integrations/meta/meta.module';

@Module({
  imports: [MetaModule],
  controllers: [DailyReportController],
  providers: [DailyReportService],
})
export class DailyReportModule {}
