import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PushService, PushSubscriptionInput } from './push.service';

@Controller('push')
export class PushController {
  constructor(private pushService: PushService) {}

  // Public -- the VAPID public key is not a secret, the frontend needs it
  // before the user is necessarily logged in to a fresh session.
  @Get('vapid-public-key')
  getPublicKey() {
    return { publicKey: this.pushService.getPublicKey() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(@Body() sub: PushSubscriptionInput, @Req() req: any) {
    return this.pushService.saveSubscription(req.user?.userId ?? null, sub).then(() => ({ success: true }));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('subscribe')
  unsubscribe(@Body() body: { endpoint: string }) {
    return this.pushService.removeSubscription(body.endpoint).then(() => ({ success: true }));
  }
}
