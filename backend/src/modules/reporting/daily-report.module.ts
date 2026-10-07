import { Module } from '@nestjs/common';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import { MetaModule } from '../integrations/meta/meta.module';
import { TwilioModule } from '../integrations/whatsapp/twilio.module';

@Module({
  imports: [MetaModule, TwilioModule],
  controllers: [DailyReportController],
  providers: [DailyReportService],
})
export class DailyReportModule {}
