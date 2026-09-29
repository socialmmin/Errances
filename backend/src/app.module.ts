import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PoolModule } from './common/db/pool.module';
import { R2Module } from './common/r2/r2.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { BranchesModule } from './modules/branches/branches.module';
import { LeadsModule } from './modules/leads/leads.module';
import { CustomersModule } from './modules/customers/customers.module';
import { PackagesModule } from './modules/packages/packages.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { FinanceModule } from './modules/finance/finance.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { HealthModule } from './modules/health/health.module';
import { FilesModule } from './modules/files/files.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MetaModule } from './modules/integrations/meta/meta.module';
import { WhatsAppBotModule } from './modules/integrations/whatsapp/whatsapp-bot.module';
import { DailyReportModule } from './modules/reporting/daily-report.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PoolModule,
    R2Module,
    AuthModule,
    UsersModule,
    BranchesModule,
    LeadsModule,
    CustomersModule,
    PackagesModule,
    QuotationsModule,
    BookingsModule,
    FinanceModule,
    VendorsModule,
    ReportsModule,
    TasksModule,
    HealthModule,
    FilesModule,
    SettingsModule,
    MetaModule,
    WhatsAppBotModule,
    DailyReportModule,
  ],
})
export class AppModule {}
