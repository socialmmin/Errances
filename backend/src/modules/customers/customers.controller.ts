import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { BranchAccessService } from '../../common/guards/branch-access.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private customersService: CustomersService, private branchAccess: BranchAccessService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Req() req?: any,
  ) {
    // branchId used to be an optional filter the caller could simply omit to see every branch's
    // customers -- it's now the actual access boundary: super_admin may still pick any branch (or
    // none, for "all"), everyone else is pinned to their own regardless of what they send.
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.customersService.findAll({
      branchId: effectiveBranchId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  async findOne(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('customers', id, req.user);
    return this.customersService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_CREATE)
  create(@Body() dto: CreateCustomerDto, @Req() req: any) {
    return this.customersService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @Req() req: any) {
    await this.branchAccess.assertAccess('customers', id, req.user);
    return this.customersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_DELETE)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('customers', id, req.user);
    return this.customersService.remove(id);
  }
}
