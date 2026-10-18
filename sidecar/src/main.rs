//! Obscura sidecar: the only process that holds spend keys.
//!
//! Exposes a small HTTP API to the TypeScript side:
//!   POST /new_address   {account}            -> {ua, diversifier_index}
//!   POST /send          {to, amount_zat, memo} -> {txid}
//!   GET  /scan_incoming ?account&from_height -> [{txid, height, output_index, value_zat, memo, to_ua, pool}]
//!   GET  /balance       ?account             -> {orchard_zat}
//!   GET  /tx_status     ?txid                -> {mined_height | null}
//!
//! The Zcash backend (librustzcash vs zingo-cli) is chosen by the spike; see docs/PROGRESS.md.

fn main() {
    println!("obscura-sidecar: backend not wired yet (see docs/PROGRESS.md, step 1)");
}
