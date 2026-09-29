import { IsUUID } from 'class-validator';

export class AssignPtaDto {
  @IsUUID() userId!: string;
}
