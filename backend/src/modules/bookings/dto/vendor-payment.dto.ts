import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class VendorPaymentDto {
  @IsUUID() vendorId!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() notes?: string;
}
