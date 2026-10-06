import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsEmail() email?: string;
  @IsString() @MinLength(1) fullName!: string;
  @IsString() @MinLength(5) password!: string;
  // Mobile is the login identity -- required. Either a 10-digit Indian mobile (an optional
  // +91/91/0 prefix is stripped before saving) or, for staff outside India (Errances has French
  // offices), an international number written with its + country code, saved as +<digits>.
  // Login matches on the last 10 digits, so both forms sign in the same way.
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const raw = value.trim();
    if (raw.startsWith('+') && !raw.replace(/[\s-]/g, '').startsWith('+91')) return '+' + raw.replace(/\D/g, '');
    let d = raw.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  })
  @Matches(/^([6-9]\d{9}|\+\d{8,15})$/, { message: 'Enter a valid mobile number: 10 digits, or international with its + country code' })
  phone!: string;
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional() @IsString() employeeCode?: string;
  @IsUUID() roleId!: string;
  // No longer asked for in the form -- defaults to the creating admin's own branch server-side.
  @IsOptional() @IsUUID() branchId?: string;
}
