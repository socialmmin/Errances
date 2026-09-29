import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';

// Full CRUD (list/invite/edit/deactivate) for the Settings > Users module,
// ported from hala-audit/frontend/src/pages/settings (users tab).
@Module({
  controllers: [UsersController],
})
export class UsersModule {}
