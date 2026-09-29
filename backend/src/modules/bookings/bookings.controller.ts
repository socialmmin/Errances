import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { VendorPaymentDto } from './dto/vendor-payment.dto';
import { AssignPtaDto } from './dto/assign-pta.dto';
import { CreateChecklistItemDto, ToggleChecklistItemDto } from './dto/checklist-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BOOKINGS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bookingsService.findAll({
      branchId,
      status,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.BOOKINGS_VIEW)
  stats(@Query('branchId') branchId?: string) {
    return this.bookingsService.stats(branchId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BOOKINGS_VIEW)
  findOne(@Param('id') id: string) {
    return this.bookingsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BOOKINGS_CREATE)
  create(@Body() dto: CreateBookingDto, @Req() req: any) {
    return this.bookingsService.create(dto, req.user?.userId ?? null);
  }

  @Post('from-quotation/:quotationId')
  @RequirePermissions(PERMISSIONS.BOOKINGS_CREATE)
  createFromQuotation(@Param('quotationId') quotationId: string, @Body() dto: CreateBookingDto, @Req() req: any) {
    return this.bookingsService.create({ ...dto, quotationId }, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.bookingsService.update(id, dto);
  }

  @Patch(':id/approve')
  @RequirePermissions(PERMISSIONS.FINANCE_APPROVE_REFUND)
  approve(@Param('id') id: string, @Req() req: any) {
    return this.bookingsService.approve(id, req.user?.userId ?? null);
  }

  @Patch(':id/assign-pta')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  assignPta(@Param('id') id: string, @Body() dto: AssignPtaDto) {
    return this.bookingsService.assignPta(id, dto.userId);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.bookingsService.updateStatus(id, status);
  }

  @Post(':id/checklist')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  addChecklistItem(@Param('id') id: string, @Body() dto: CreateChecklistItemDto) {
    return this.bookingsService.addChecklistItem(id, dto.item);
  }

  @Post(':id/checklist/:itemId/toggle')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  toggleChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleChecklistItemDto,
    @Req() req: any,
  ) {
    return this.bookingsService.toggleChecklistItem(id, itemId, dto.isDone ?? true, req.user?.userId ?? null);
  }

  @Post(':id/payments')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @Req() req: any) {
    return this.bookingsService.recordPayment(
      id,
      dto.amount,
      dto.method ?? null,
      dto.reference ?? null,
      req.user?.branchId,
      req.user?.userId ?? null,
      dto.status,
    );
  }

  @Post(':id/vendor-payments')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  addVendorPayment(@Param('id') id: string, @Body() dto: VendorPaymentDto, @Req() req: any) {
    return this.bookingsService.addVendorPayment(
      id,
      dto.vendorId,
      dto.amount,
      dto.notes ?? null,
      req.user?.branchId,
      req.user?.userId ?? null,
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BOOKINGS_CANCEL)
  remove(@Param('id') id: string) {
    return this.bookingsService.remove(id);
  }
}
