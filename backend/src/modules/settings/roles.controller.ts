import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

// Read-only view of the 11-role taxonomy + their permissions. Roles
// themselves are not created/edited through the UI — they mirror the
// static map in common/rbac/role-permissions.ts, this just exposes the
// `roles` table rows (id/name/description) for the Settings > Roles page
// and for role-select dropdowns elsewhere (e.g. Users).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_ROLES)
  async findAll() {
    const { rows } = await this.pool.query(
      `SELECT id, name, permissions, description FROM roles WHERE is_deleted = false ORDER BY name`,
    );
    return { data: rows, total: rows.length };
  }
}
