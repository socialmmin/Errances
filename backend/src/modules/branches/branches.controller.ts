import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('branches')
export class BranchesController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  async findAll() {
    const { rows } = await this.pool.query(
      `SELECT * FROM branches WHERE is_deleted = false ORDER BY created_at DESC`,
    );
    return { data: rows, total: rows.length };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async create(@Body() dto: CreateBranchDto, @Req() req: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO branches (name, city, country, phone, email, address, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [dto.name, dto.city ?? null, dto.country ?? 'India', dto.phone ?? null, dto.email ?? null, dto.address ?? null, req.user?.userId ?? null],
    );
    return rows[0];
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    const sets: string[] = [];
    const args: any[] = [];
    for (const [key, col] of [
      ['name', 'name'], ['city', 'city'], ['country', 'country'], ['phone', 'phone'],
      ['email', 'email'], ['address', 'address'], ['isActive', 'is_active'],
    ] as const) {
      const val = (dto as any)[key];
      if (val !== undefined) { args.push(val); sets.push(`${col} = $${args.length}`); }
    }
    if (!sets.length) {
      const { rows } = await this.pool.query(`SELECT * FROM branches WHERE id = $1`, [id]);
      return rows[0] || null;
    }
    args.push(id);
    const { rows } = await this.pool.query(
      `UPDATE branches SET ${sets.join(', ')}, updated_at = now() WHERE id = $${args.length} AND is_deleted = false RETURNING *`,
      args,
    );
    return rows[0] || null;
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async remove(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `UPDATE branches SET is_deleted = true, updated_at = now() WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }
}
