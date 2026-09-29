import { IsIn, IsOptional, IsString } from 'class-validator';

export const INVOICE_TYPES = ['proforma', 'tax_invoice', 'credit_note'];

export class CreateInvoiceDto {
  @IsString() bookingId!: string;
  @IsOptional() @IsIn(INVOICE_TYPES) type?: string;
  @IsOptional() @IsString() dueDate?: string;
}
