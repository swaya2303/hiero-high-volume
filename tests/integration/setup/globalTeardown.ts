/**
 * Global teardown for integration tests.
 *
 * Cleans up the skip sentinel file and logs the total suite duration.
 */

import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_SENTINEL_PATH = join(__dirname, '..', '.skip');

export default async function globalTeardown(): Promise<void> {
  // ── Clean up skip sentinel ─────────────────────────────────────────
  if (existsSync(SKIP_SENTINEL_PATH)) {
    unlinkSync(SKIP_SENTINEL_PATH);
  }

  // ── Log total duration ─────────────────────────────────────────────
  const startMs = Number(process.env['_INTEGRATION_START_MS'] ?? '0');
  if (startMs > 0) {
    const durationMs = Date.now() - startMs;
    const durationSec = (durationMs / 1000).toFixed(1);
    console.log(`[Integration] Suite completed in ${durationSec}s`);
  }
}
