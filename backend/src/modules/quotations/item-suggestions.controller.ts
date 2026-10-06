import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// Remembered item names for the quotation builder's cost tables (Hotel/Transport/Flight-Train/
// Activities/Other) -- typing "Campfire" once under Activities offers it back as a suggestion
// next time, instead of everyone retyping the same handful of items from scratch every quotation.
@UseGuards(JwtAuthGuard)
@Controller('quotations/item-suggestions')
export class ItemSuggestionsController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  async findAll(@Query('category') category: string) {
    const { rows } = await this.pool.query(
      `SELECT id, category, label FROM quotation_item_suggestions
       WHERE category = $1 AND is_deleted = false ORDER BY label ASC`,
      [category],
    );
    return { data: rows };
  }

  @Post()
  async create(@Body() dto: { category: string; label: string }, @Req() req: any) {
    const label = (dto.label || '').trim();
    if (!label || !dto.category) return null;
    const { rows: existing } = await this.pool.query(
      `SELECT id, category, label FROM quotation_item_suggestions
       WHERE category = $1 AND lower(label) = lower($2) AND is_deleted = false LIMIT 1`,
      [dto.category, label],
    );
    if (existing[0]) return existing[0];
    const { rows } = await this.pool.query(
      `INSERT INTO quotation_item_suggestions (category, label, created_by) VALUES ($1,$2,$3) RETURNING id, category, label`,
      [dto.category, label, req.user?.userId ?? null],
    );
    return rows[0];
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: { label: string }) {
    const label = (dto.label || '').trim();
    if (!label) return null;
    const { rows } = await this.pool.query(
      `UPDATE quotation_item_suggestions SET label = $1 WHERE id = $2 AND is_deleted = false RETURNING id, category, label`,
      [label, id],
    );
    return rows[0] || null;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `UPDATE quotation_item_suggestions SET is_deleted = true WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }
}
