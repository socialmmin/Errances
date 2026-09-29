import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ReportsRepository } from './reports.repository';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private repo: ReportsRepository) {}

  @Get('revenue')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  revenue(@Query('branchId') branchId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.repo.revenue(branchId, from, to);
  }

  @Get('conversion')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  conversion(@Query('branchId') branchId?: string) {
    return this.repo.conversionBySource(branchId);
  }

  @Get('lost-reasons')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  lostReasons(@Query('branchId') branchId?: string) {
    return this.repo.lostReasons(branchId);
  }

  @Get('destinations')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  destinations(@Query('branchId') branchId?: string) {
    return this.repo.destinations(branchId);
  }

  @Get('outstanding')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  outstanding(@Query('branchId') branchId?: string) {
    return this.repo.outstanding(branchId);
  }

  @Get('sales-performance')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  salesPerformance(@Query('branchId') branchId?: string) {
    return this.repo.salesPerformance(branchId);
  }

  @Get('executive/:userId')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async executive(@Param('userId') userId: string) {
    const profile = await this.repo.executiveProfile(userId);
    const leads = await this.repo.executiveLeads(userId);
    const assigned = leads.length;
    const converted = leads.filter((l: any) => l.status === 'won').length;
    const revenue = leads
      .filter((l: any) => l.status === 'won')
      .reduce((s: number, l: any) => s + Number(l.expected_revenue ?? 0), 0);
    return {
      profile,
      leads,
      stats: {
        assigned,
        converted,
        revenue,
        rate: assigned > 0 ? Math.round((converted / assigned) * 100) : 0,
      },
    };
  }

  // Summary retained for backward compatibility with the original stub route.
  @Get('summary')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async summary(@Query('branchId') branchId?: string) {
    const [revenue, conversion, outstanding] = await Promise.all([
      this.repo.revenue(branchId, undefined, undefined),
      this.repo.conversionBySource(branchId),
      this.repo.outstanding(branchId),
    ]);
    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
    const totalLeads = conversion.reduce((s, c) => s + c.total, 0);
    const totalBooked = conversion.reduce((s, c) => s + c.booked, 0);
    const totalOutstanding = outstanding.reduce((s, o: any) => s + o.balance_amount, 0);
    return {
      totalRevenue,
      overallConversionRate: totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 100) : 0,
      totalOutstanding,
    };
  }
}
