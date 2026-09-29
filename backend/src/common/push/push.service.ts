import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as webpush from 'web-push';
import { PG_POOL } from '../db/pool.module';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

@Injectable()
export class PushService {
  private logger = new Logger('PushService');
  private configured = false;

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT') || 'mailto:admin@errances.socialmm.in';
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set -- push notifications disabled');
    }
  }

  getPublicKey(): string | null {
    return this.config.get<string>('VAPID_PUBLIC_KEY') || null;
  }

  async saveSubscription(userId: string | null, sub: PushSubscriptionInput) {
    await this.pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );
  }

  async removeSubscription(endpoint: string) {
    await this.pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  }

  // Broadcasts to every registered device. New leads are a whole-team
  // concern here (small ops team), so no per-user targeting yet.
  async notifyAll(payload: { title: string; body: string; url?: string }) {
    if (!this.configured) return;

    const { rows } = await this.pool.query(
      `SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
       LEFT JOIN users u ON u.id = ps.user_id
       WHERE u.id IS NULL OR u.notifications_enabled = true`,
    );
    if (rows.length === 0) return;

    const message = JSON.stringify(payload);
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            message,
          );
        } catch (err: any) {
          // 404/410 = subscription expired or unsubscribed client-side -- clean it up.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await this.removeSubscription(row.endpoint).catch(() => undefined);
          } else {
            this.logger.error(`Push send failed for ${row.endpoint}: ${err.message}`);
          }
        }
      }),
    );
  }

  async notifyUsers(userIds: string[], payload: { title: string; body: string; url?: string }, includeSuperAdmins = true) {
    if (!this.configured) { this.logger.warn(`notifyUsers skipped -- VAPID keys not configured (title: ${payload.title})`); return; }
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
       LEFT JOIN users u ON u.id=ps.user_id LEFT JOIN roles r ON r.id=u.role_id
       WHERE (ps.user_id=ANY($1::uuid[]) OR ($2 AND r.name='super_admin'))
         AND COALESCE(u.notifications_enabled, true) = true`,
      [userIds, includeSuperAdmins],
    );
    if (!rows.length) { this.logger.warn(`notifyUsers: no matching subscriptions for userIds=[${userIds.join(',')}] includeSuperAdmins=${includeSuperAdmins} (title: ${payload.title})`); return; }
    const message = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    await Promise.all(rows.map(async (row) => {
      try { await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message); sent++; }
      catch (err: any) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) await this.removeSubscription(row.endpoint).catch(() => undefined);
        else this.logger.error(`Push send failed: ${err.message}`);
      }
    }));
    this.logger.log(`notifyUsers: ${sent}/${rows.length} delivered (${failed} failed) -- ${payload.title}`);
  }
}
