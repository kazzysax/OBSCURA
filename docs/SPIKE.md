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

## Update 2026-10-19 — real backend written and compiling

- **Crate line decided: pre-release.** `zcash_protocol 0.11.0-pre.1` hard-codes testnet NU7 at 4,465,026; stable `0.10.6` has `Nu7 => None`, so a stable-crate wallet would mis-handle current testnet blocks. Pinned versions match zcash/zcash-devtool (commit 0b3436b, 2026-10-17): `zcash_client_backend =0.25.0-pre.2`, `zcash_client_sqlite =0.23.0-pre.2`, `zcash_keys =0.17.0-pre.2`, `zcash_primitives/zcash_proofs =0.31.0-pre.2`, `zip321 =0.10.0-pre.2`, `zcash_address =0.14.0-pre.2`.
- **Backend decision: librustzcash** (not zingo-cli). `sidecar/src/zcash.rs` compiles against the real APIs:
  - (a) wallet: random 32-byte seed (`seed.hex`, 0600), `WalletDb` + `init_wallet_db`, birthday from `GetTreeState` just below the tip
  - (b) fresh Orchard-only UA: `get_next_available_address` with `UnifiedAddressRequest::custom(Require, Omit, Omit)`
  - (c) send with memo: `propose_transfer` (ZIP-317, Orchard change) → `create_proposed_transactions` (`LocalTxProver::bundled()`) → `SendTransaction`
  - (d) detect incoming + memos: `sync::run` with an in-memory `BlockCache`, then "enhancement" (`transaction_data_requests` → `GetTransaction` → `decrypt_and_store_transaction`, since compact blocks carry no memos), then read `v_tx_outputs`
  - (e) accounts: ZIP-32 account 0 = voting, 1 = auction (one account per round is a later step)
- **Not yet exercised against a live server**: `init` reaches the TLS connect and fails with `transport error` because this environment's proxy refuses lightwalletd hosts. Nothing else is untested in principle, but expect first-run fixes.

### Run it (on a machine that can reach testnet.zec.rocks)

```bash
cargo build --release --manifest-path sidecar/Cargo.toml
ZCASH_NETWORK=testnet SIDECAR_WALLET_DIR=./wallet ./sidecar/target/release/obscura-sidecar init
ZCASH_NETWORK=testnet SIDECAR_BACKEND=zcash ./sidecar/target/release/obscura-sidecar   # serves :8402
curl -s -XPOST localhost:8402/new_address -d '{"account":"voting"}'                     # fund this from a testnet faucet
curl -s 'localhost:8402/scan_incoming?from_height=0'                                    # the faucet payment appears here
USE_MOCK_CHAIN=false ZCASH_NETWORK=testnet pnpm agent                                   # the agent now uses the real chain
```
