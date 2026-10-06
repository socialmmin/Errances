import { Global, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/pool.module';
import { AccessMap, effectiveAccess } from './access-catalog';

// Marks a route (or controller) as belonging to one or more access keys -- the user needs ANY of
// them switched on. Several keys because the same data legitimately feeds more than one screen
// (e.g. follow-ups show on the Follow-ups page AND the dashboard's "Calls & follow-ups" section).
export const ACCESS_KEY = 'requiredAccess';
export const RequireAccess = (...keys: string[]) => SetMetadata(ACCESS_KEY, keys);

// The per-employee overrides live in users.page_access. Looked up on every guarded request, so
// cached briefly per user; any change made in the access panel clears that user's entry
// immediately, so a switch takes effect on their very next request rather than after the TTL.
@Injectable()
export class AccessService {
  private cache = new Map<string, { overrides: AccessMap | null; at: number }>();
  private static TTL_MS = 30_000;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async overridesFor(userId: string): Promise<AccessMap | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < AccessService.TTL_MS) return hit.overrides;
    const { rows } = await this.pool.query(`SELECT page_access FROM users WHERE id = $1`, [userId]);
    const overrides = (rows[0]?.page_access ?? null) as AccessMap | null;
    this.cache.set(userId, { overrides, at: Date.now() });
    return overrides;
  }

  async effectiveFor(userId: string, roleName: string | undefined): Promise<AccessMap> {
    return effectiveAccess(roleName, await this.overridesFor(userId));
  }

  invalidate(userId: string) {
    this.cache.delete(userId);
  }
}

@Global()
@Module({ providers: [AccessService], exports: [AccessService] })
export class AccessModule {}
