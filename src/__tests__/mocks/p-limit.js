/**
 * CJS shim for p-limit (ESM-only package).
 *
 * Provides a simple pass-through concurrency limiter that works
 * in the ts-jest (CJS) environment. Does not enforce actual
 * concurrency limits — real concurrency is handled by the network.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pLimit(_concurrency) {
  return function limit(fn) {
    return fn();
  };
}

module.exports = pLimit;
module.exports.default = pLimit;
module.exports.__esModule = true;
