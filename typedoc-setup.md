# TypeDoc and GitHub Pages Setup for hiero-high-volume

This document outlines the steps and configurations required to generate a hosted API reference site using TypeDoc and deploy it to GitHub Pages.

## Part 1: TypeDoc Configuration

Create a `typedoc.json` file in the root of the project with the following content:

```json
{
  "entryPoints": ["src/index.ts", "src/react/index.ts"],
  "entryPointStrategy": "resolve",
  "out": "docs/api",
  "name": "hiero-high-volume",
  "readme": "README.md",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeInternal": true,
  "plugin": ["typedoc-plugin-markdown"],
  "githubPages": true,
  "hideGenerator": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Core", "Batch", "Cost", "Events", "React", "Errors", "*"]
}
```

## Part 2: JSDoc Additions

Apply the following JSDoc block additions to the specified source files.

```diff
--- a/src/HighVolumeCreator.ts
+++ b/src/HighVolumeCreator.ts
@@ -xx,xx +xx,xx @@
+/**
+ * Core entry point for the hiero-high-volume library.
+ * Handles batch entity creation, cost estimation, and event emission.
+ * 
+ * @example
+ * ```typescript
+ * const creator = new HighVolumeCreator({
+ *   operatorId: process.env.HEDERA_OPERATOR_ID!,
+ *   operatorKey: process.env.HEDERA_OPERATOR_KEY!,
+ *   network: 'testnet'
+ * });
+ * // Output: HighVolumeCreator default instance
+ * ```
+ */
 export class HighVolumeCreator {
```

```diff
--- a/src/HighVolumeCreator.ts
+++ b/src/HighVolumeCreator.ts
@@ -xx,xx +xx,xx @@
+  /**
+   * Creates multiple Hedera accounts in bulk, automatically applying HIP-1313 volume discounts if applicable.
+   * 
+   * @example
+   * ```typescript
+   * const result = await creator.batchCreateAccounts(100, {
+   *   onProgress: (stats) => console.log(`${stats.completed}/${stats.total} accounts created`)
+   * });
+   * // Output: { items: [{ success: true, entityId: "0.0.12345", ... }], summary: { completed: 100, ... } }
+   * ```
+   */
   public async batchCreateAccounts(
```

```diff
--- a/src/HighVolumeCreator.ts
+++ b/src/HighVolumeCreator.ts
@@ -xx,xx +xx,xx @@
+  /**
+   * Generates a minimum, expected, and maximum cost estimate for a batch operation.
+   * 
+   * @example
+   * ```typescript
+   * const estimate = await creator.estimateCost(10000, 'account', true);
+   * // Output: { minHbar: 220, expectedHbar: 275, maxHbar: 330, warning: "Warning: High network volume" }
+   * ```
+   */
   public async estimateCost(
```

```diff
--- a/src/cost/CostEstimator.ts
+++ b/src/cost/CostEstimator.ts
@@ -xx,xx +xx,xx @@
+/**
+ * Internal helper to calculate cost bounds based on current network fees and requested volume.
+ * 
+ * @param count - The total number of entities to be created in the batch.
+ * @param entityType - The type of Hedera entity ('account', 'token', or 'topic').
+ * @param baseFeeHbar - The standard single-entity creation fee in HBAR before volume discounts.
+ * @param useHighVolumeMode - Whether to apply the HIP-1313 high-volume discount formula.
+ */
 export function buildCostEstimate(
```

```diff
--- a/src/types.ts
+++ b/src/types.ts
@@ -xx,xx +xx,xx @@
+/**
+ * Summary statistics returned upon completion of a batch job.
+ * 
+ * @remarks
+ * Note that `totalFeeChargedHbar` may be 0 if the job was cancelled or encountered a
+ * fatal error before any entity was successfully created and submitted to the network.
+ */
 export interface BatchJobSummary {
```

```diff
--- a/src/retry/RetryHandler.ts
+++ b/src/retry/RetryHandler.ts
@@ -xx,xx +xx,xx @@
+/**
+ * Executes an operation with exponential backoff and jitter.
+ * 
+ * @throws {MaxRetriesExceededError} If the maximum number of retry attempts is exhausted.
+ * @throws {HieroClientError} For non-retryable errors or network anomalies outside the retryable statuses.
+ */
 export async function withRetry<T>(
```

```diff
--- a/src/types.ts
+++ b/src/types.ts
@@ -xx,xx +xx,xx @@
+/**
+ * List of transaction types eligible for high-volume fee discounts under HIP-1313.
+ * 
+ * @since 0.1.0
+ * @see {@link https://hips.hedera.com/hip/hip-1313}
+ */
 export const SUPPORTED_HIGH_VOLUME_TRANSACTIONS = [
```

## Part 3: GitHub Actions Deploy Workflow

Create the following workflow file at `.github/workflows/docs.yml`:

```yaml
name: Deploy API Reference

on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  deploy-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build project types
        run: npm run build

      - name: Generate TypeDoc
        run: npx typedoc

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v4

      - name: Upload pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'docs/api'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4

      - name: Comment on triggering commit
        if: github.event_name == 'push'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.repos.createCommitComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              commit_sha: context.sha,
              body: `📚 API Documentation deployed: https://${context.repo.owner}.github.io/${context.repo.repo}/`
            })
```

## Part 4: npm Scripts

Add the following command scripts to the `scripts` object in your `package.json`:

```json
{
  "docs": "typedoc",
  "docs:watch": "typedoc --watch"
}
```

## Note on Using typedoc-plugin-markdown

Using `typedoc-plugin-markdown` is vastly preferred over TypeDoc's native HTML generators for GitHub Pages deployments because GitHub Pages natively leverages the Jekyll static site generator to parse `.md` files into HTML. By exporting standard Markdown rather than raw static HTML files, we avoid complex visual clashes or CSS overrides, allowing the documentation to render natively with the host repository's Jekyll theme layout and mobile-responsive wrappers. Furthermore, this approach natively surfaces your API semantics within GitHub's core repository search index, and strictly prevents cross-origin resource sharing (CORS) or iframe constraint violations when serving modular component documentation from subdirectory environments like `/docs/api`.
