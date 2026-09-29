import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';

// Full CRUD for branches, ported from
// hala-audit/frontend/src/pages/settings (branches tab).
@Module({ controllers: [BranchesController] })
export class BranchesModule {}
