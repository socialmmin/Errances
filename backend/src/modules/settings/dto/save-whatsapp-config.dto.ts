import { IsOptional, IsString, MinLength } from 'class-validator';

export class SaveWhatsAppConfigDto {
  @IsString() @MinLength(1) phoneNumberId!: string;
  @IsString() @MinLength(1) accessToken!: string;
  @IsOptional() @IsString() businessAccountId?: string;
}
