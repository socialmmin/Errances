import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Accepts either an email or a phone number as the login identifier.
  @IsString()
  @MinLength(3)
  email!: string;

  @IsString()
  @MinLength(5)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
