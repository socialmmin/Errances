import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vendors')
export class VendorsController {
  constructor(private vendorsService: VendorsService, private branchAccess: BranchAccessService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Req() req?: any,
  ) {
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.vendorsService.findAll({
      branchId: effectiveBranchId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  async findOne(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('vendors', id, req.user);
    return this.vendorsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VENDORS_CREATE)
  create(@Body() dto: CreateVendorDto, @Req() req: any) {
    return this.vendorsService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateVendorDto, @Req() req: any) {
    await this.branchAccess.assertAccess('vendors', id, req.user);
    return this.vendorsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('vendors', id, req.user);
    return this.vendorsService.remove(id);
  }
}
