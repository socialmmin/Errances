import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateChecklistItemDto {
  @IsString() item!: string;
}

export class ToggleChecklistItemDto {
  @IsOptional() @IsBoolean() isDone?: boolean;
}
