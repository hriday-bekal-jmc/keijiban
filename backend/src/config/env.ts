// Env vars loaded via node/tsx --env-file-if-exists=.env (see package.json scripts)
const required = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID']

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}

export interface Env {
  port: number
  databaseUrl: string
  jwtSecret: string
  googleClientId: string
  allowedDomain: string
  cookieDomain: string
  isDev: boolean
  appBaseUrl: string
  superAdminEmails: Set<string>
  googleServiceAccountKey: Record<string, unknown> | null
  driveSharedDriveId: string | null
  gmailSenderEmail: string | null
  gmailUser: string | null
  gmailAppPassword: string | null
}

export const env: Env = {
  port: parseInt(process.env.PORT || '3001'),
  databaseUrl: process.env.DATABASE_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
  googleClientId: process.env.GOOGLE_CLIENT_ID as string,
  allowedDomain: process.env.ALLOWED_EMAIL_DOMAIN || 'jmc-ltd.co.jp',
  cookieDomain: process.env.COOKIE_DOMAIN || 'localhost',
  isDev: process.env.NODE_ENV === 'development',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  superAdminEmails: new Set(
    (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  ),
  // Google Drive — optional; uploads disabled when absent
  googleServiceAccountKey: (() => {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    if (!raw) return null
    try { return JSON.parse(raw) as Record<string, unknown> } catch { return null }
  })(),
  driveSharedDriveId: process.env.DRIVE_SHARED_DRIVE_ID || null,
  // Email — optional; email disabled when absent
  gmailSenderEmail: process.env.GMAIL_SENDER_EMAIL || null,
  gmailUser:        process.env.GMAIL_USER        || null,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || null,
}
