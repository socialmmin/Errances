import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // Lightweight active-user list for assignment dropdowns (leads, tasks) --
  // needs only leads:assign, not the full settings:users admin permission.
  // Self-service: this user's own notification preference (independent of the
  // browser's own permission state, which is a separate, per-device thing).
  @Get('me/notifications')
  getMyNotificationPreference(@Req() req: any) {
    return this.pool.query(`SELECT notifications_enabled FROM users WHERE id = $1`, [req.user?.userId])
      .then(({ rows }) => ({ enabled: rows[0]?.notifications_enabled ?? true }));
  }

  @Patch('me/notifications')
  async setMyNotificationPreference(@Body() dto: { enabled: boolean }, @Req() req: any) {
    await this.pool.query(`UPDATE users SET notifications_enabled = $1 WHERE id = $2`, [!!dto.enabled, req.user?.userId]);
    return { enabled: !!dto.enabled };
  }

  @Get('assignable')
  @RequirePermissions(PERMISSIONS.LEADS_ASSIGN)
  async findAssignable() {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.employee_code FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.is_deleted=false AND u.is_active=true AND r.name <> 'super_admin'
         AND r.permissions ? 'leads:view' ORDER BY u.full_name ASC`,
    );
    return { data: rows };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async findAll() {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.full_name, u.employee_code, u.phone, u.branch_id, u.role_id, u.is_active, u.participate_round_robin, u.last_login_at, u.created_at,
              r.name AS role_name, b.name AS branch_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.is_deleted = false ORDER BY u.created_at DESC`,
    );
    return { data: rows, total: rows.length };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async create(@Body() dto: CreateUserDto) {
    if (!dto.email && !dto.phone) throw new ConflictException('Enter an email address or mobile number');
    const digits=(dto.phone || '').replace(/[^0-9]/g,'');
    const email=dto.email || `${digits}@mobile.errance.local`;
    const { rows: existing } = await this.pool.query(`SELECT id FROM users WHERE lower(email)=lower($1) OR ($2<>'' AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g')=$2)`, [email,digits]);
    if (existing.length) throw new ConflictException('A user with this email or mobile number already exists');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, employee_code, role_id, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, full_name, employee_code, phone, branch_id, role_id, is_active, created_at`,
      [email, passwordHash, dto.fullName, dto.phone ?? null, dto.employeeCode ?? null, dto.roleId, dto.branchId],
    );
    return rows[0];
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const sets: string[] = [];
    const args: any[] = [];
    for (const [key, col] of [
      ['fullName', 'full_name'], ['phone', 'phone'], ['employeeCode', 'employee_code'],
      ['roleId', 'role_id'], ['branchId', 'branch_id'], ['isActive', 'is_active'], ['participateRoundRobin', 'participate_round_robin'],
    ] as const) {
      const val = (dto as any)[key];
      if (val !== undefined) { args.push(val); sets.push(`${col} = $${args.length}`); }
    }
    if (dto.password) { args.push(await bcrypt.hash(dto.password,10)); sets.push(`password_hash = $${args.length}`); }
    if (!sets.length) {
      const { rows } = await this.pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
      return rows[0] || null;
    }
    args.push(id);
    const { rows } = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${args.length} AND is_deleted = false
       RETURNING id, email, full_name, employee_code, phone, branch_id, role_id, is_active, participate_round_robin`,
      args,
    );
    return rows[0] || null;
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async remove(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `UPDATE users SET is_deleted = true, is_active = false, updated_at = now() WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }
}
