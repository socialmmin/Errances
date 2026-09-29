import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'done', 'cancelled'];

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() relatedType?: string;
  @IsOptional() @IsUUID() relatedId?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;

  @IsUUID()
  branchId!: string;
}
