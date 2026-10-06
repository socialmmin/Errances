import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard, ThrottlerLimitDetail, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';

// Logs every rate-limit trip (login brute-force, a runaway WhatsApp-send loop, etc.) instead of
// just silently returning 429 with nothing to look back at afterwards.
@Injectable()
export class AuditedThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private audit: AuditService,
  ) {
    super(options, storageService, reflector);
  }

  protected async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const req = context.switchToHttp().getRequest();
    this.audit.log({
      userId: req?.user?.userId ?? null,
      branchId: req?.user?.branchId ?? null,
      action: 'rate_limit_triggered',
      resourceType: 'http',
      resourceId: req?.originalUrl ?? req?.url ?? null,
      result: 'denied',
      ip: req?.ip ?? null,
    });
    return super.throwThrottlingException(context, detail);
  }
}
