import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() participateRoundRobin?: boolean;
  @IsOptional() @IsString() @MinLength(6) password?: string;
}
