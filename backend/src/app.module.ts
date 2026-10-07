import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditedThrottlerGuard } from './common/guards/audited-throttler.guard';
import { PoolModule } from './common/db/pool.module';
import { AuditModule } from './common/audit/audit.module';
import { AccessModule } from './common/access/access.service';
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
import { BroadcastsModule } from './modules/broadcasts/broadcasts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Generous global default (every route was previously completely unthrottled) -- stricter,
    // endpoint-specific limits (login, WhatsApp send) are applied with @Throttle on top of this.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PoolModule,
    AuditModule,
    AccessModule,
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
    BroadcastsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuditedThrottlerGuard }],
})
export class AppModule {}
