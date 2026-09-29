import { IsEmail, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const VENDOR_TYPES = ['hotel', 'transport', 'guide', 'restaurant', 'activity', 'other'];

export class CreateVendorDto {
  @IsString()
  name!: string;

  @IsOptional() @IsIn(VENDOR_TYPES) type?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() gstNumber?: string;

  @IsUUID()
  branchId!: string;
}
