import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsEmail() email?: string;
  @IsString() @MinLength(1) fullName!: string;
  @IsString() @MinLength(6) password!: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() phone?: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() employeeCode?: string;
  @IsUUID() roleId!: string;
  @IsUUID() branchId!: string;
}
