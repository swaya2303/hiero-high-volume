# Contributing to hiero-high-volume

## Before you start

Browse [open issues labeled `good first issue`](https://github.com/your-org/hiero-high-volume/labels/good%20first%20issue) for starter tasks. If you're planning a larger change, open an issue first so maintainers can discuss scope before you write code.

**All contributors must GPG-sign every commit and include a DCO sign-off before their first PR will be reviewed.** No exceptions. Setup instructions are below — complete them before your first commit.

## Setting up GPG signing

### macOS (Homebrew)

```bash
# 1. Install GnuPG
brew install gnupg

# 2. Generate a 4096-bit RSA key pair
gpg --full-generate-key
# Select: (1) RSA and RSA, 4096 bits, key does not expire
# Enter your name and the email address associated with your GitHub account

# 3. List your keys and copy the key ID (long hex string after "sec rsa4096/")
gpg --list-secret-keys --keyid-format=long

# 4. Export your public key and paste it at https://github.com/settings/gpg/new
gpg --armor --export YOUR_KEY_ID

# 5. Configure git to sign all commits
git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true
git config --global gpg.program gpg
```

### Ubuntu / Debian

```bash
# 1. Install GnuPG (usually pre-installed)
sudo apt update && sudo apt install -y gnupg

# 2–5. Same commands as macOS (gpg --full-generate-key, etc.)
gpg --full-generate-key
gpg --list-secret-keys --keyid-format=long
gpg --armor --export YOUR_KEY_ID
# Paste at https://github.com/settings/gpg/new

git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true
git config --global gpg.program gpg
```

### Verification

After setup, make a test commit and verify the signature:

```bash
git commit --allow-empty -s -m "test: verify GPG signing"
git log --show-signature -1
# Should show "Good signature from ..." — not "No signature"
```

## DCO sign-off

The [Developer Certificate of Origin (DCO)](https://developercertificate.org/) certifies that you wrote the code or have the right to submit it. Every commit in a PR must carry a `Signed-off-by` footer.

Use the `-s` flag — it handles this automatically:

```bash
git commit -s -m "feat: add topic batch creator"
```

This produces the footer:

```
feat: add topic batch creator

Signed-off-by: Your Name <your.email@example.com>
```

If you forget `-s` on a commit, amend it:

```bash
git commit --amend -s
```

## Development workflow

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/hiero-high-volume.git
cd hiero-high-volume

# 2. Install dependencies
npm install

# 3. Create a branch (naming: type/short-description)
git checkout -b feat/hip1313-token-support
# Examples: fix/retry-timeout, docs/cost-estimation, test/batch-cancel

# 4. Make your changes, then verify locally
npm test
npm run lint
npm run typecheck

# 5. Commit (signed + DCO)
git commit -s -m "feat: add token batch creator with HIP-1313 flag"

# 6. Push to your fork
git push origin feat/hip1313-token-support

# 7. Open a Pull Request against the main branch
```

## Running tests

### Unit tests

```bash
npm test
```

Runs the full Jest suite (92 tests across 6 suites).

### Coverage

```bash
npx jest --coverage
```

Coverage thresholds enforced: branches 80%, functions 90%, lines 90%, statements 90%.

### Integration tests (Hedera testnet)

Integration tests create real entities on testnet and cost testnet HBAR.

```bash
# 1. Get free testnet credentials at https://portal.hedera.com
#    Create an account → copy Account ID and DER-encoded private key

# 2. Set environment variables
export HEDERA_OPERATOR_ID="0.0.XXXXX"
export HEDERA_OPERATOR_KEY="302e020100..."
export HEDERA_KEY_TYPE="ED25519"   # optional, defaults to ED25519

# 3. Run integration tests
npm run test:integration
```

To skip integration tests (e.g., in CI without credentials):

```bash
SKIP_INTEGRATION=true npm run test:integration
```

## Commit message format

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Enforced by `commitlint.config.mjs`.

```
<type>(<optional scope>): <description>
```

One example per type:

| Type | Example |
|------|---------|
| `feat` | `feat: add batchCreateTokens with HIP-1313 discount` |
| `fix` | `fix: retry handler not resetting delay after success` |
| `docs` | `docs: add cost estimation examples to README` |
| `test` | `test: add integration tests for topic creation` |
| `refactor` | `refactor: extract fee calculation into CostEstimator` |
| `chore` | `chore: upgrade @hashgraph/sdk to 2.46` |

A `BREAKING CHANGE:` footer triggers a major version bump:

```
feat: change estimateCost return type

BREAKING CHANGE: estimateCost now returns Promise<CostEstimate> instead of CostEstimate
```

## Pull request checklist

Before requesting review, verify:

- [ ] `npm test` passes locally
- [ ] `npx jest --coverage` — coverage has not regressed below thresholds
- [ ] No new `any` types introduced (check with `npm run typecheck`)
- [ ] DCO sign-off present on **every** commit (`git log --format='%h %s | %GS' -5`)
- [ ] GPG signatures valid on all commits (`git log --show-signature -3`)
- [ ] `CHANGELOG.md` updated if the change is user-facing
- [ ] `README.md` updated if the public API changed

## What gets rejected without review

These result in immediate close-without-review:

- PRs without GPG-signed commits on every commit
- PRs without DCO sign-off on every commit
- PRs that reduce test coverage below the configured thresholds (branches 80%, functions/lines/statements 90%)
- PRs adding `@hashgraph/sdk` imports to `src/types.ts` or any file in `src/cost/` — these modules must remain SDK-free
