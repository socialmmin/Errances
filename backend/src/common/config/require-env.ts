// A missing JWT secret used to silently fall back to a hardcoded dev value
// ('dev-access-secret' / 'dev-refresh-secret') -- in production that means anyone who knows
// (or finds, e.g. in this very repo's history) the default string can forge a valid login
// token for any user. Fail closed instead: if a required secret isn't actually configured,
// the app should refuse to start rather than quietly run insecurely.
export function requireEnv(config: { get<T = string>(key: string): T | undefined }, key: string): string {
  const value = config.get<string>(key);
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key} -- refusing to start without it (no insecure default is allowed in production).`);
  }
  return value;
}
