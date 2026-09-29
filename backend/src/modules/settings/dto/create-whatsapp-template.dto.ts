import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWhatsAppTemplateDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) bodyTemplate!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
