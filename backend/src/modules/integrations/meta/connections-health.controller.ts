import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { R2Service } from '../../../common/r2/r2.service';
import { PushService } from '../../../common/push/push.service';
import { MetaService } from './meta.service';

// Live health for Settings → Integrations (Meta Ads, R2 storage, push). Each check calls the real
// service -- never just "a credential is saved", which is what hid the WhatsApp webhook outage.
// Super admin only: it exposes account names and balances.
@UseGuards(JwtAuthGuard)
@Controller('integrations/connections-health')
export class ConnectionsHealthController {
  constructor(private meta: MetaService, private r2: R2Service, private push: PushService) {}

  @Get()
  async all(@Req() req: any) {
    if (req.user?.roleName !== 'super_admin') throw new ForbiddenException('Only a super admin can view connection health');
    const [metaAds, storage, push] = await Promise.all([
      this.meta.health().catch((e) => ({ error: (e as Error).message })),
      this.r2.health().catch((e) => ({ error: (e as Error).message })),
      this.push.health().catch((e) => ({ error: (e as Error).message })),
    ]);
    return { checkedAt: new Date().toISOString(), metaAds, storage, push };
  }
}
