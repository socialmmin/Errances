import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private repo: CustomersRepository) {}

  findAll(params: { branchId?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.findAll({
      branchId: params.branchId,
      search: params.search,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  }

  async findOne(id: string) {
    const customer = await this.repo.findOne(id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  create(dto: CreateCustomerDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Customer not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Customer not found');
    return { success: true };
  }
}
