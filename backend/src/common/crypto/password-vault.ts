import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Admin-viewable copy of an employee's password (the owner asked to be able to tell a staff member
// their password when they forget it). Login still checks only the bcrypt hash; this AES-256-GCM
// copy is only ever decrypted for a super admin, and every reveal is audit-logged.
// Key: PASSWORD_VAULT_KEY if set, otherwise derived from JWT_REFRESH_SECRET -- so rotating that
// secret makes previously stored copies unreadable (they then show as "reset to view").
function key(): Buffer {
  const base = process.env.PASSWORD_VAULT_KEY || process.env.JWT_REFRESH_SECRET || '';
  if (!base) throw new Error('PASSWORD_VAULT_KEY / JWT_REFRESH_SECRET not configured');
  return createHash('sha256').update(`password-vault:${base}`).digest();
}

export function sealPassword(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function openPassword(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [v, iv, tag, enc] = sealed.split(':');
    if (v !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
