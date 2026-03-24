/**
 * Global test setup — runs after the test framework initializes.
 *
 * Suppresses noisy `console.log` and `console.info` output during test runs
 * while keeping `console.error` and `console.warn` active so genuine issues
 * surface immediately.
 */

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
