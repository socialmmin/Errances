import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { WhatsAppController } from './whatsapp.controller';
import { CompanySettingsController } from './company-settings.controller';
import { TrashController } from './trash.controller';
import { TwilioModule } from '../integrations/whatsapp/twilio.module';

// Settings sub-modules that don't already have a dedicated module:
// read-only Roles view + WhatsApp templates/logs/config.
// Branches and Users CRUD live in their own existing modules.
@Module({ imports: [TwilioModule], controllers: [RolesController, WhatsAppController, CompanySettingsController, TrashController] })
export class SettingsModule {}
