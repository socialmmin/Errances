import { IsIn, IsOptional, IsString } from 'class-validator';
import { INVOICE_TYPES } from './create-invoice.dto';

export const INVOICE_STATUSES = ['pending', 'partial', 'paid', 'overdue', 'refunded'];

export class UpdateInvoiceDto {
  @IsOptional() @IsIn(INVOICE_STATUSES) status?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsIn(INVOICE_TYPES) type?: string;
}
