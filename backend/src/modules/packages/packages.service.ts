import { Injectable, NotFoundException } from '@nestjs/common';
import { PackagesRepository } from './packages.repository';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

@Injectable()
export class PackagesService {
  constructor(private repo: PackagesRepository) {}

  findAll(params: { branchId?: string; search?: string; type?: string; isTemplate?: boolean; page?: number; pageSize?: number }) {
    return this.repo.findAll({
      branchId: params.branchId,
      search: params.search,
      type: params.type,
      isTemplate: params.isTemplate,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  }

  async findOne(id: string) {
    const pkg = await this.repo.findOne(id);
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }

  findByCampaignName(campaignName: string) {
    return this.repo.findByCampaignName(campaignName);
  }

  findManyByCampaignName(campaignName: string) {
    return this.repo.findManyByCampaignName(campaignName);
  }

  findByDestination(destination: string) {
    return this.repo.findByDestination(destination);
  }

  findManyByDestination(destination: string) {
    return this.repo.findManyByDestination(destination);
  }

  create(dto: CreatePackageDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdatePackageDto) {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Package not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Package not found');
    return { success: true };
  }
}
