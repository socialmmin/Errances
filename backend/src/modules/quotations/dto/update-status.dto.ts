import { IsIn } from 'class-validator';

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'];

export class UpdateStatusDto {
  @IsIn(QUOTATION_STATUSES) status!: string;
}
