/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],

  // Only match files ending in .test.ts or .test.tsx — exclude setup.ts and mock factories
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/index.ts',
    '!src/types.ts',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'src/react/',
    'src/__tests__/',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },

  // Map .js imports to .ts source for NodeNext module resolution
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^p-limit$': '<rootDir>/src/__tests__/mocks/p-limit.js',
  },

  // Transform ESM-only packages (p-limit and its dependency yocto-queue)
  transformIgnorePatterns: [
    'node_modules/(?!(p-limit|yocto-queue)/)',
  ],

  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
};
