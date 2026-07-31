import { query } from '../config/db.js'
import { env } from '../config/env.js'
import { sweepOrphanedDriveFiles, type SweepResult } from './drive.js'

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 60_000

/**
 * Every Drive id the database still points at. Each attachment row references
 * two files: the full-size upload (`drive_file_id`) and the thumbnail, whose
 * id is embedded in `thumbnail_path` as /api/uploads/<id>/content.
 */
export async function referencedDriveIds(): Promise<Set<string>> {
  const { rows } = await query<{ drive_file_id: string; thumbnail_path: string | null }>(
    'SELECT drive_file_id, thumbnail_path FROM attachments'
  )
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.drive_file_id) ids.add(r.drive_file_id)
    const m = r.thumbnail_path?.match(/\/api\/uploads\/([^/]+)\/content/)
    if (m) ids.add(m[1])
  }
  return ids
}

/** Collect the reference set, then sweep. Throws if Drive is unconfigured. */
export async function runDriveSweep(opts: { dryRun?: boolean } = {}): Promise<SweepResult> {
  return sweepOrphanedDriveFiles(await referencedDriveIds(), opts)
}

export function startDriveSweep(): void {
  if (!env.googleServiceAccountKey || !env.driveSharedDriveId) {
    console.info('[drive-sweep] disabled — needs GOOGLE_SERVICE_ACCOUNT_KEY and DRIVE_SHARED_DRIVE_ID')
    return
  }
  const run = (): void => {
    runDriveSweep()
      .then(r => console.info('[drive-sweep]', r))
      .catch(err => console.error('[drive-sweep] failed:', (err as Error).message))
  }
  // Not at boot: let the app settle, and avoid every restart triggering a scan
  setTimeout(run, FIRST_RUN_DELAY_MS).unref()
  setInterval(run, SWEEP_INTERVAL_MS).unref()
}
