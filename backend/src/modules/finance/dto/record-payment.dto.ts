import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsNumber() @Min(1) amount!: number;
  @IsString() method!: string;
  @IsOptional() @IsString() reference?: string;
}
