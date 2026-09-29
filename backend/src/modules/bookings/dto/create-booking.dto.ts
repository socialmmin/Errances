import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateBookingDto {
  @IsUUID() customerId!: string;
  @IsOptional() @IsUUID() quotationId?: string;
  @IsOptional() @IsUUID() packageId?: string;
  @IsOptional() @IsDateString() travelFrom?: string;
  @IsOptional() @IsDateString() travelTo?: string;
  @IsOptional() @IsInt() @Min(0) adults?: number;
  @IsOptional() @IsInt() @Min(0) children?: number;
  @IsOptional() @Min(0) totalAmount?: number;
  @IsUUID() branchId!: string;
}
