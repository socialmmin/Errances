import { Injectable, NotFoundException } from '@nestjs/common';
import { BookingsRepository } from './bookings.repository';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

@Injectable()
export class BookingsService {
  constructor(private repo: BookingsRepository) {}

  findAll(params: { branchId?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.findAll({
      branchId: params.branchId,
      status: params.status,
      search: params.search,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  }

  stats(branchId?: string) {
    return this.repo.stats(branchId);
  }

  async findOne(id: string) {
    const booking = await this.repo.findOne(id);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  create(dto: CreateBookingDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateBookingDto) {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Booking not found');
    return updated;
  }

  async approve(id: string, userId: string | null) {
    const updated = await this.repo.approve(id, userId);
    if (!updated) throw new NotFoundException('Booking not found');
    return updated;
  }

  async assignPta(id: string, userId: string) {
    const updated = await this.repo.assignPta(id, userId);
    if (!updated) throw new NotFoundException('Booking not found');
    return updated;
  }

  async updateStatus(id: string, status: string) {
    const updated = await this.repo.updateStatus(id, status);
    if (!updated) throw new NotFoundException('Booking not found');
    return updated;
  }

  async toggleChecklistItem(bookingId: string, itemId: string, isDone: boolean, userId: string | null) {
    const item = await this.repo.toggleChecklistItem(bookingId, itemId, isDone, userId);
    if (!item) throw new NotFoundException('Checklist item not found');
    return item;
  }

  addChecklistItem(bookingId: string, item: string) {
    return this.repo.addChecklistItem(bookingId, item);
  }

  recordPayment(bookingId: string, amount: number, method: string | null, reference: string | null, branchId: string, userId: string | null, status?: string) {
    return this.repo.recordPayment(bookingId, amount, method ?? null, reference ?? null, branchId, userId, status ?? 'completed');
  }

  addVendorPayment(bookingId: string, vendorId: string, amount: number, notes: string | null, branchId: string, userId: string | null) {
    return this.repo.addVendorPayment(bookingId, vendorId, amount, notes ?? null, branchId, userId);
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Booking not found');
    return { success: true };
  }
}
