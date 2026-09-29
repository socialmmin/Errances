import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card'];
export const PAYMENT_ENTRY_STATUSES = ['completed', 'pending'];

export class RecordPaymentDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: string;
  @IsOptional() @IsString() reference?: string;
  // 'pending' — a PTA/field collection awaiting Finance verification (does
  // not move the booking ledger until verified). Omit or 'completed' for a
  // direct accountant-entered payment, which counts immediately.
  @IsOptional() @IsIn(PAYMENT_ENTRY_STATUSES) status?: string;
}
