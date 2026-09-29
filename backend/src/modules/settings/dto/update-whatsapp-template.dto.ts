import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateWhatsAppTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() bodyTemplate?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
