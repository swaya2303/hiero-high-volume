/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Only match integration test files
  testMatch: ['**/tests/integration/**/*.test.ts'],

  // Real network calls are slow — generous timeout per test
  testTimeout: 60_000,

  // Serial execution to avoid testnet rate limiting
  maxWorkers: 1,

  // Map .js imports to .ts source for NodeNext module resolution
  // and p-limit ESM-only package to a CJS shim
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^p-limit$': '<rootDir>/src/__tests__/mocks/p-limit.js',
  },

  // Global lifecycle scripts
  globalSetup: './tests/integration/setup/globalSetup.ts',
  globalTeardown: './tests/integration/setup/globalTeardown.ts',
};
