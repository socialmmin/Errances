import { Body, Controller, Get, Inject, Logger, Post } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { R2Service } from '../../common/r2/r2.service';

// Modeled off hala-audit/backend/src/index.ts health-check wiring shape.
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('ClientError');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private r2: R2Service,
  ) {}

  // The app previously had no error boundary, so any render crash showed Next.js's blank
  // "Application error" page and the real cause only ever existed in the browser's own
  // console -- unrecoverable and invisible to us. The error boundary now POSTs the actual
  // message/stack/URL here so `docker logs` shows exactly what broke, instead of guessing.
  @Post('client-error')
  logClientError(@Body() body: { message?: string; stack?: string; url?: string; userAgent?: string }) {
    this.logger.error(`${body.url || 'unknown page'}: ${body.message || 'no message'}\n${body.stack || ''}`);
    return { ok: true };
  }

  @Get()
  async check() {
    let db = 'down';
    try {
      await this.pool.query('SELECT 1');
      db = 'up';
    } catch {
      db = 'down';
    }

    const r2Configured = this.r2.isConfigured();
    const r2Reachable = r2Configured ? await this.r2.checkReachable() : false;

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      db,
      r2: r2Configured ? (r2Reachable ? 'up' : 'down') : 'not_configured',
    };
  }
}
