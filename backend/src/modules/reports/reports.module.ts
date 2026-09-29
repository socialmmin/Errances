import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';

// Reporting/analytics endpoints aggregating leads/bookings/payments/users,
// ported from hala-audit/frontend/src/pages/reports.
@Module({ controllers: [ReportsController], providers: [ReportsRepository] })
export class ReportsModule {}
