import { Injectable, NotFoundException } from '@nestjs/common';
import { FinanceRepository } from './finance.repository';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class FinanceService {
  constructor(private repo: FinanceRepository) {}

  findInvoices(params: { branchId?: string; status?: string; type?: string }) {
    return this.repo.findInvoices(params);
  }

  async createInvoice(dto: CreateInvoiceDto, branchId: string, userId: string | null) {
    const invoice = await this.repo.createInvoice(dto, branchId, userId);
    if (!invoice) throw new NotFoundException('Booking not found');
    return invoice;
  }

  async updateInvoice(id: string, dto: UpdateInvoiceDto) {
    const updated = await this.repo.updateInvoice(id, dto);
    if (!updated) throw new NotFoundException('Invoice not found');
    return updated;
  }

  async removeInvoice(id: string) {
    const deleted = await this.repo.softDeleteInvoice(id);
    if (!deleted) throw new NotFoundException('Invoice not found');
    return deleted;
  }

  kpis(branchId?: string) {
    return this.repo.kpis(branchId);
  }

  findPayments(params: { branchId?: string; status?: string }) {
    return this.repo.findPayments(params);
  }

  findOverdueInstallments(branchId?: string) {
    return this.repo.findOverdueInstallments(branchId);
  }

  findTodayPtaCollections(branchId?: string) {
    return this.repo.findTodayPtaCollections(branchId);
  }

  async verifyPayment(id: string, userId: string | null) {
    const payment = await this.repo.verifyPayment(id, userId);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async rejectPayment(id: string, userId: string | null, reason: string | null) {
    const payment = await this.repo.rejectPayment(id, userId, reason);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }
}
