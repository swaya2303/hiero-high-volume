# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-22

### Added
- **Batch Account Creation:** `batchCreateAccounts` with configurable initial balances and ED25519/ECDSA key generation.
- **Batch Token Creation:** `batchCreateTokens` with configurable names, symbols, and initial supplies.
- **Batch Topic Creation:** `batchCreateTopics` with configurable memos.
- **Cost Estimation:** `estimateCost` API that calculates expected fees with ±20% variance bounds based on current Hedera base prices.
- **HIP-1313 Support:** Automatic parsing and application of high-volume fee discounts (up to 45% off) for batches larger than 1,000 entities.
- **Progress Tracking:** Real-time `onProgress` and `onEntityCreated` callbacks exposing `JobStats` (completed, failed, elapsed time, current fee rate).
- **React Dashboard Components:** Initial stub implementations for frontend visibility into batch job execution.

[0.1.0]: https://github.com/YOUR_ORG/hiero-high-volume/releases/tag/v0.1.0
