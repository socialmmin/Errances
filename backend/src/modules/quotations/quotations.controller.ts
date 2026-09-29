import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private quotationsService: QuotationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.quotationsService.findAll({
      branchId,
      status,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  stats(@Query('branchId') branchId?: string) {
    return this.quotationsService.stats(branchId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  findOne(@Param('id') id: string) {
    return this.quotationsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTATIONS_CREATE)
  create(@Body() dto: CreateQuotationDto, @Req() req: any) {
    return this.quotationsService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto) {
    return this.quotationsService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @Req() req: any) {
    return this.quotationsService.updateStatus(id, dto.status, req.user?.userId ?? null);
  }

  @Post(':id/send-whatsapp')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  sendWhatsApp(@Param('id') id: string, @Req() req: any) {
    return this.quotationsService.sendViaWhatsApp(id, req.user?.userId ?? null);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_DELETE)
  remove(@Param('id') id: string) {
    return this.quotationsService.remove(id);
  }
}
