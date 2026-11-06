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
  /**
   * When there is no organization yet, let the first person to open the app
   * create it and its admin account. The desktop test build turns this on;
   * a server leaves it off and is seeded from the command line instead.
   */
  firstRunSetup: boolean;
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
    firstRunSetup: process.env.FIRST_RUN_SETUP === 'true',
    ...overrides,
  };
  if (config.firstRunSetup && !config.ownerDatabaseUrl) {
    throw new Error('FIRST_RUN_SETUP needs DATABASE_URL (the owner connection) to create the organization.');
  }
  if (config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.');
  }
  return config;
}
