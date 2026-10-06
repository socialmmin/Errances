import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const QUOTATION_ITEM_CATEGORIES = [
  'package',
  'hotel',
  'flight',
  'transport',
  'activity',
  'visa',
  'insurance',
  'guide',
  'other',
];

export class QuotationItemDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(60) category!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) quantity?: number;
  @Type(() => Number) @IsNumber() unitCost!: number;
  @IsOptional() @Type(() => Number) @IsNumber() markupPct?: number;
}

export class CreateQuotationDto {
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  // Used only when leadId is not supplied -- a customer typed directly into the quotation
  // builder rather than picked from the existing lead list. The server looks them up by phone
  // (not name, since spelling varies but the number doesn't) before creating a new lead, so the
  // same person never ends up with two lead records just because they weren't searched for.
  @IsOptional() @IsString() newCustomerName?: string;
  @IsOptional() @IsString() newCustomerPhone?: string;
  @IsOptional() @IsString() newCustomerEmail?: string;
  @IsOptional() @IsString() newCustomerSource?: string;
  @IsOptional() @IsUUID() packageId?: string;
  // Which of the customer's requirements this quotation is for (1, 2, 3 ...).
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) requirementNo?: number;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsDateString() travelFrom?: string;
  @IsOptional() @IsDateString() travelTo?: string;
  @IsOptional() @IsInt() @Min(0) adults?: number;
  @IsOptional() @IsInt() @Min(0) children?: number;
  @IsOptional() @IsInt() @Min(0) infants?: number;
  @IsOptional() @IsNumber() @Min(0) discountPct?: number;
  @IsOptional() @IsNumber() @Min(0) gstPct?: number;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() internalNotes?: string;
  @IsUUID() branchId!: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuotationItemDto) items?: QuotationItemDto[];
}
