import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const QUOTATION_ITEM_CATEGORIES = [
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
  @IsIn(QUOTATION_ITEM_CATEGORIES) category!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsNumber() unitCost!: number;
  @IsOptional() @IsNumber() markupPct?: number;
}

export class CreateQuotationDto {
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() packageId?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsDateString() travelFrom?: string;
  @IsOptional() @IsDateString() travelTo?: string;
  @IsOptional() @IsInt() @Min(0) adults?: number;
  @IsOptional() @IsInt() @Min(0) children?: number;
  @IsOptional() @IsNumber() @Min(0) discountPct?: number;
  @IsOptional() @IsNumber() @Min(0) gstPct?: number;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() internalNotes?: string;
  @IsUUID() branchId!: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuotationItemDto) items?: QuotationItemDto[];
}
