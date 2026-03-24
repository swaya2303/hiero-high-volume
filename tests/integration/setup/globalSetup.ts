/**
 * Global setup for integration tests.
 *
 * Checks for required environment variables and creates a skip sentinel
 * file when integration tests should be skipped. This runs once before
 * any test suite is loaded.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_SENTINEL_PATH = join(__dirname, '..', '.skip');

const REQUIRED_ENV_VARS = ['HEDERA_OPERATOR_ID', 'HEDERA_OPERATOR_KEY'] as const;

/**
 * Mask an operator ID for safe logging.
 * Shows first 6 and last 4 characters, asterisks in between.
 * e.g. "0.0.12****5678"
 */
function maskOperatorId(operatorId: string): string {
  if (operatorId.length <= 10) return operatorId;
  const prefix = operatorId.slice(0, 6);
  const suffix = operatorId.slice(-4);
  const masked = '*'.repeat(operatorId.length - 10);
  return `${prefix}${masked}${suffix}`;
}

export default async function globalSetup(): Promise<void> {
  // ── Skip if explicitly disabled ────────────────────────────────────
  if (process.env['SKIP_INTEGRATION'] === 'true') {
    writeFileSync(SKIP_SENTINEL_PATH, 'skipped', 'utf-8');
    console.log('[Integration] Skipped: SKIP_INTEGRATION=true');
    return;
  }

  // ── Check required environment variables ───────────────────────────
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    throw new Error(
      `[Integration] Missing required environment variable(s): ${missing.join(', ')}.\n` +
        `See CONTRIBUTING.md for setup instructions on acquiring testnet HBAR\n` +
        `and configuring HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, and HEDERA_KEY_TYPE.`,
    );
  }

  // ── Log startup ────────────────────────────────────────────────────
  const operatorId = process.env['HEDERA_OPERATOR_ID']!;
  const maskedId = maskOperatorId(operatorId);
  console.log(`[Integration] Running against Hedera testnet with operator: ${maskedId}`);

  // Store start time for duration logging in teardown
  process.env['_INTEGRATION_START_MS'] = String(Date.now());
}
