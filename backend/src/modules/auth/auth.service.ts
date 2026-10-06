import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { requireEnv } from '../../common/config/require-env';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  private async issueTokens(user: {
    id: string;
    email: string;
    role_name: string;
    branch_id: string | null;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      roleName: user.role_name,
      branchId: user.branch_id,
    };
    const accessToken = this.jwt.sign(payload, {
      secret: requireEnv(this.config, 'JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '1h',
    });
    const refreshExpiry = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';
    const sid = randomUUID();
    const refreshToken = this.jwt.sign({ ...payload, sid }, {
      secret: requireEnv(this.config, 'JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiry,
    });
    const decoded: any = this.jwt.decode(refreshToken);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    // Each sign-in gets its own session, so other tabs/devices stay signed in.
    await this.pool.query(
      `INSERT INTO refresh_sessions(id, user_id, token_hash, expires_at) VALUES($1,$2,$3,to_timestamp($4))`,
      [sid, user.id, refreshTokenHash, decoded.exp],
    );
    await this.pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    await this.pool.query(
      `DELETE FROM refresh_sessions WHERE user_id = $1 AND (expires_at < now() OR id NOT IN
         (SELECT id FROM refresh_sessions WHERE user_id = $1 ORDER BY last_used_at DESC LIMIT 25))`,
      [user.id],
    );

    return { accessToken, refreshToken };
  }

  async login(email: string, password: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.branch_id, u.is_active,
              r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE (lower(u.email)=lower($1)
              -- Mobile login: compare the last 10 digits so +91 / 91 / 0 prefixes all work. Only
              -- when the input actually has 10+ digits -- otherwise an email login (no digits)
              -- compared '' = '' and matched every user without a phone, picking the wrong account.
              OR (length(regexp_replace($1,'[^0-9]','','g')) >= 10
                  AND right(regexp_replace(COALESCE(u.phone,''),'[^0-9]','','g'), 10) = right(regexp_replace($1,'[^0-9]','','g'), 10)))
         AND u.is_deleted = false
       ORDER BY (lower(u.email)=lower($1)) DESC
       LIMIT 1`,
      [email],
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      // Login identifier logged, never the password -- same reasoning as not logging JWTs/API keys.
      this.audit.log({ action: 'login_failed', resourceType: 'auth', result: 'failed', detail: { identifier: email } });
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      this.audit.log({ userId: user.id, branchId: user.branch_id, action: 'login_failed', resourceType: 'auth', result: 'failed' });
      throw new UnauthorizedException('Invalid credentials');
    }
    this.audit.log({ userId: user.id, branchId: user.branch_id, action: 'login_succeeded', resourceType: 'auth', result: 'success' });
    const tokens = await this.issueTokens(user);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roleName: user.role_name,
        branchId: user.branch_id,
      },
    };
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: requireEnv(this.config, 'JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.branch_id, u.refresh_token_hash, u.is_active,
              r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_deleted = false`,
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.sid) {
      const { rows: sessions } = await this.pool.query(
        `SELECT token_hash FROM refresh_sessions WHERE id = $1 AND user_id = $2 AND expires_at > now()`,
        [payload.sid, user.id],
      );
      if (!sessions[0] || !(await bcrypt.compare(refreshToken, sessions[0].token_hash))) {
        throw new UnauthorizedException('Refresh token has been revoked');
      }
      await this.pool.query(`UPDATE refresh_sessions SET last_used_at = now() WHERE id = $1`, [payload.sid]);
      // No rotation: concurrent tabs refreshing at once cannot invalidate each other.
      const accessToken = this.jwt.sign(
        { sub: user.id, email: user.email, roleName: user.role_name, branchId: user.branch_id },
        {
          secret: requireEnv(this.config, 'JWT_ACCESS_SECRET'),
          expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '1h',
        },
      );
      return { accessToken, refreshToken };
    }
    // Sessions created before this change carry no session id: accept the legacy
    // stored hash once and upgrade them to a proper session.
    if (!user.refresh_token_hash || !(await bcrypt.compare(refreshToken, user.refresh_token_hash))) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    return this.issueTokens(user);
  }

  async logout(userId: string) {
    await this.pool.query(`UPDATE users SET refresh_token_hash = NULL WHERE id = $1`, [userId]);
    await this.pool.query(`DELETE FROM refresh_sessions WHERE user_id = $1`, [userId]);
    return { success: true };
  }
}
