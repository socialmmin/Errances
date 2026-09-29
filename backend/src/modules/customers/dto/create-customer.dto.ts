import { IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

const CUSTOMER_TYPES = ['individual', 'corporate', 'agent'];

export class CreateCustomerDto {
  @IsString()
  fullName!: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsappNumber?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsDateString() anniversaryDate?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsIn(CUSTOMER_TYPES) type?: string;
  @IsOptional() @IsInt() @Min(0) loyaltyPoints?: number;
  @IsOptional() @IsString() referralSource?: string;
  @IsOptional() @IsUUID() referredBy?: string;
  @IsOptional() @IsUUID() leadId?: string;

  @IsUUID()
  branchId!: string;
}
