import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { WhatsAppController } from './whatsapp.controller';
import { CompanySettingsController } from './company-settings.controller';
import { TrashController } from './trash.controller';

// Settings sub-modules that don't already have a dedicated module:
// read-only Roles view + WhatsApp templates/logs/config.
// Branches and Users CRUD live in their own existing modules.
@Module({ controllers: [RolesController, WhatsAppController, CompanySettingsController, TrashController] })
export class SettingsModule {}
