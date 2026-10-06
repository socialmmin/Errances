import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsEmail() email?: string;
  @IsString() @MinLength(1) fullName!: string;
  @IsString() @MinLength(5) password!: string;
  // Mobile is the login identity -- required, and must be a real 10-digit Indian mobile
  // (an optional +91/91/0 prefix is accepted and stripped before saving).
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    let d = value.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  })
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit mobile number' })
  phone!: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() employeeCode?: string;
  @IsUUID() roleId!: string;
  // No longer asked for in the form -- defaults to the creating admin's own branch server-side.
  @IsOptional() @IsUUID() branchId?: string;
}
