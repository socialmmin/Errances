import { Injectable, NotFoundException } from '@nestjs/common';
import { VendorsRepository } from './vendors.repository';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

@Injectable()
export class VendorsService {
  constructor(private repo: VendorsRepository) {}

  findAll(params: { branchId?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.findAll({
      branchId: params.branchId,
      search: params.search,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  }

  async findOne(id: string) {
    const vendor = await this.repo.findOne(id);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  create(dto: CreateVendorDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateVendorDto) {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Vendor not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Vendor not found');
    return { success: true };
  }
}
