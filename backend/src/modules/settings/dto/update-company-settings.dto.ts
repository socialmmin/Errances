import { IsOptional, IsString, MaxLength } from 'class-validator';
export class UpdateCompanySettingsDto {
  @IsOptional() @IsString() @MaxLength(150) companyName?: string;
  @IsOptional() @IsString() @MaxLength(150) legalName?: string;
  @IsOptional() @IsString() @MaxLength(100) tagline?: string;
  @IsOptional() @IsString() @MaxLength(600) logoUrl?: string | null;
  @IsOptional() @IsString() logoObjectKey?: string | null;
  @IsOptional() @IsString() @MaxLength(600) faviconUrl?: string | null;
  @IsOptional() @IsString() faviconObjectKey?: string | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(150) email?: string;
  @IsOptional() @IsString() @MaxLength(250) website?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(30) gstin?: string;
  @IsOptional() @IsString() @MaxLength(150) bankName?: string;
  @IsOptional() @IsString() @MaxLength(150) bankAccountName?: string;
  @IsOptional() @IsString() @MaxLength(50) bankAccountNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) bankIfsc?: string;
  @IsOptional() @IsString() @MaxLength(150) bankBranch?: string;
  @IsOptional() @IsString() @MaxLength(100) upiId?: string;
}
