export interface Config {
  port: number;
  /** Restricted role; row-level security applies. */
  appDatabaseUrl: string;
  /** Owner role; migrations and seed only. */
  ownerDatabaseUrl: string;
  sessionSecret: string;
  cookieSecure: boolean;
  storageDir: string;
  sessionDays: number;
  logLevel: string;
  /** Address people use to open the app, for links in email and Teams (e.g. https://notes.example.com). */
  publicUrl: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const config: Config = {
    port: Number(process.env.API_PORT ?? 3000),
    appDatabaseUrl: overrides.appDatabaseUrl ?? required('APP_DATABASE_URL'),
    ownerDatabaseUrl: overrides.ownerDatabaseUrl ?? process.env.DATABASE_URL ?? '',
    sessionSecret: overrides.sessionSecret ?? required('SESSION_SECRET'),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    storageDir: process.env.STORAGE_DIR ?? './data/assets',
    sessionDays: Number(process.env.SESSION_DAYS ?? 14),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
    ...overrides,
  };
  if (config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.');
  }
  return config;
}
