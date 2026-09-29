import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { R2Module } from '../../common/r2/r2.module';

@Module({
  imports: [R2Module],
  controllers: [FilesController],
})
export class FilesModule {}
