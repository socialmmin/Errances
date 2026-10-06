import { Controller, ForbiddenException, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { ReportsRepository } from './reports.repository';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { RequireAccess } from '../../common/access/access.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('reports')
@Controller('reports')
export class ReportsController {
  constructor(private repo: ReportsRepository, @Inject(PG_POOL) private pool: Pool) {}

  // branchId used to be an optional client-supplied filter -- any user with reports:view could
  // see every branch's revenue/conversion/outstanding numbers just by leaving it off (same class
  // of gap already fixed on Leads/Customers/Bookings/etc). super_admin can still pick any branch
  // (or none, for "all"); everyone else is pinned to their own.
  private effectiveBranchId(requested: string | undefined, user: any) {
    return user?.roleName === 'super_admin' ? requested : user?.branchId;
  }

  @Get('revenue')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  revenue(@Query('branchId') branchId?: string, @Query('from') from?: string, @Query('to') to?: string, @Req() req?: any) {
    return this.repo.revenue(this.effectiveBranchId(branchId, req?.user), from, to);
  }

  @Get('conversion')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  conversion(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.repo.conversionBySource(this.effectiveBranchId(branchId, req?.user));
  }

  @Get('lost-reasons')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  lostReasons(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.repo.lostReasons(this.effectiveBranchId(branchId, req?.user));
  }

  @Get('destinations')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  destinations(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.repo.destinations(this.effectiveBranchId(branchId, req?.user));
  }

  @Get('outstanding')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  outstanding(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.repo.outstanding(this.effectiveBranchId(branchId, req?.user));
  }

  @Get('sales-performance')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  salesPerformance(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.repo.salesPerformance(this.effectiveBranchId(branchId, req?.user));
  }

  @Get('executive/:userId')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async executive(@Param('userId') userId: string, @Req() req: any) {
    // Real IDOR: any user with reports:view could pull ANY other employee's full performance
    // profile (assigned leads, conversion rate, revenue) just by guessing/iterating a user id --
    // nothing here ever checked the target user was even in the same branch as the caller.
    if (req.user?.roleName !== 'super_admin') {
      const { rows } = await this.pool.query(`SELECT branch_id FROM users WHERE id = $1`, [userId]);
      if (!rows[0] || rows[0].branch_id !== req.user?.branchId) {
        throw new ForbiddenException("You don't have access to this employee's report");
      }
    }
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
  async summary(@Query('branchId') branchId?: string, @Req() req?: any) {
    const effective = this.effectiveBranchId(branchId, req?.user);
    const [revenue, conversion, outstanding] = await Promise.all([
      this.repo.revenue(effective, undefined, undefined),
      this.repo.conversionBySource(effective),
      this.repo.outstanding(effective),
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
