# Step 1 spike — findings (2026-10-18)

## Shielded collectible (ZSA) — NOT available before the deadline

- The zcash/zips index lists the NU7 ZIPs as 218 (25-second blocks), 235, 237, 2003 and 2008. ZIP 259 ("Deployment of the NU7 Network Upgrade") says NU7 "introduces no new transaction format".
- ZIP 226 (Transfer and Burn of Zcash Shielded Assets) and ZIP 227 (Issuance of ZSAs) are still **Draft** and not scheduled for any network upgrade.
- **Decision:** no shielded NFT. The artist-signed provenance certificate is the ownership record. Revisit if a later upgrade activates ZSAs.

Sources: https://github.com/zcash/zips (README.rst "NU7 ZIPs"), zips/zip-0259.md.

## NU7 timing affects round config

- NU7 activated on **testnet** on 2026-10-04 (block 4,465,026): testnet blocks are now **25 s**.
- Mainnet activation is targeted for **2026-11-05**, after the Oct 28 deadline, so mainnet stays at **75 s** blocks for the submission.
- ZIP 218 also adds per-pool and global shielded **action limits** per block. Batch refunds must stay well under these; settlement sends refunds in small batches (`REFUND_BATCH_SIZE`).
- Round lengths are therefore set in blocks per network: 48 blocks = 1 h on mainnet, 20 min on testnet.

## Backend libraries

| Crate | Latest stable | Latest pre-release |
|---|---|---|
| zcash_client_backend | 0.24.0 | 0.25.0-pre.2 |
| zcash_client_sqlite | 0.22.0 | 0.23.0-pre.2 |
| zcash_keys | 0.16.1 | 0.17.0-pre.2 |
| orchard | 0.16.0 | — |

Pin the stable line unless the pre-releases are needed for NU7 testnet support (likely: testnet is already on NU7, so a wallet built on pre-NU7 crates may refuse testnet blocks after activation). **Verify this first when the endpoint is reachable.**

## Chain endpoint — BLOCKED in this environment

Probed: `testnet.zec.rocks:443`, `lightwalletd.testnet.electriccoin.co:443/9067`. The cloud environment's network policy rejects these hosts (proxy `connect_rejected`), so the live part of the spike (send with memo + detect with IVK) can't run here.

To unblock: allow these hosts in the environment's network settings, or run the spike locally.
- testnet: `testnet.zec.rocks`, `lightwalletd.testnet.electriccoin.co`
- mainnet: `zec.rocks`, `mainnet.lightwalletd.com`

## Backend decision — pending the live test

Not decided yet: the rule is to verify, not guess, and neither path could be exercised here. Meanwhile:

- The sidecar's HTTP contract is fixed (see `sidecar/src/main.rs`) and implemented by a `dev` backend (in-memory chain) used for integration tests.
- Everything above the sidecar (detector, settlement, artist, web) is built and tested against that contract and the mock chain.
- When the endpoint is reachable: try `zcash_client_backend` + `zcash_client_sqlite` (stable or pre, see above) for (a) wallet, (b) fresh Orchard-only UA, (c) send with memo, (d) scan with UFVK/IVK, (e) one account per round. If any of these takes more than half a day, switch to zingo-cli behind the same contract.
