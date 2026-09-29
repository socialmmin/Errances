import { IsDateString, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateRequirementDto {
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsDateString() travelFrom?: string;
  @IsOptional() @IsDateString() travelTo?: string;
  @IsOptional() @IsInt() @Min(0) adults?: number;
  @IsOptional() @IsInt() @Min(0) children?: number;
  @IsOptional() @IsInt() @Min(0) infants?: number;
  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsObject() answers?: Record<string, string>;
}
