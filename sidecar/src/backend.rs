//! The wallet backend behind the sidecar's HTTP API.
//!
//! `Backend` is the seam where the real Zcash implementation plugs in (librustzcash or zingo-cli,
//! decided by the spike in docs/SPIKE.md). `DevBackend` is an in-memory chain with the same
//! behaviour the TypeScript mock chain has, so the HTTP contract can be tested end to end.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Account {
    Voting,
    Auction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IncomingNote {
    pub txid: String,
    pub output_index: u32,
    pub height: u64,
    pub value_zat: u64,
    pub memo: Option<String>,
    pub to_ua: String,
    pub pool: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Output {
    pub to: String,
    pub amount_zat: u64,
    pub memo: Option<String>,
}

#[derive(Debug)]
pub enum BackendError {
    BadRequest(String),
    InsufficientFunds { have: u64, need: u64 },
    /// Real backend problems (lightwalletd down, wallet not synced).
    Unavailable(String),
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackendError::BadRequest(m) => write!(f, "bad request: {m}"),
            BackendError::InsufficientFunds { have, need } => write!(f, "insufficient funds: have {have}, need {need}"),
            BackendError::Unavailable(m) => write!(f, "backend unavailable: {m}"),
        }
    }
}

pub trait Backend: Send {
    fn tip(&mut self) -> Result<u64, BackendError>;
    /// A fresh Orchard-only Unified Address; never returns the same address twice.
    fn new_address(&mut self, account: Account) -> Result<(String, String), BackendError>;
    /// One transaction paying every output from `from`. Returns the txid.
    fn send(&mut self, from: Account, outputs: &[Output]) -> Result<String, BackendError>;
    fn scan_incoming(&mut self, from_height: u64) -> Result<Vec<IncomingNote>, BackendError>;
    fn balance(&mut self, account: Account) -> Result<u64, BackendError>;
    /// Dev-only controls (simulated payments, mining). Real backends return None.
    fn dev(&mut self) -> Option<&mut DevBackend> {
        None
    }
}

/// ZIP-317: 5000 zat per logical action, minimum 2 actions (outputs + change).
pub fn zip317_fee(outputs: usize) -> u64 {
    5000 * std::cmp::max(2, outputs as u64 + 1)
}

/// In-memory dev chain. Payments land in the next block; `mine` advances the tip.
#[derive(Default)]
pub struct DevBackend {
    tip: u64,
    next: HashMap<Account, u32>,
    owned: HashMap<String, Account>,
    notes: Vec<IncomingNote>,
    spent: HashMap<Account, u64>,
    counter: u64,
}

impl DevBackend {
    pub fn new(tip: u64) -> Self {
        DevBackend { tip, ..Default::default() }
    }

    pub fn mine(&mut self, n: u64) -> u64 {
        self.tip += n;
        self.tip
    }

    fn txid(&mut self) -> String {
        self.counter += 1;
        format!("{:064x}", self.counter.wrapping_mul(0x9E37_79B9_7F4A_7C15))
    }

    /// Simulate an incoming payment (dev only).
    pub fn pay(&mut self, to: &str, value_zat: u64, memo: Option<String>) -> String {
        let txid = self.txid();
        self.notes.push(IncomingNote {
            txid: txid.clone(),
            output_index: 0,
            height: self.tip + 1,
            value_zat,
            memo,
            to_ua: to.to_string(),
            pool: "orchard".into(),
        });
        txid
    }
}

impl Backend for DevBackend {
    fn tip(&mut self) -> Result<u64, BackendError> {
        Ok(self.tip)
    }

    fn new_address(&mut self, account: Account) -> Result<(String, String), BackendError> {
        let idx = self.next.entry(account).or_insert(0);
        let i = *idx;
        *idx += 1;
        // Not a real UA: the dev backend only needs unique, recognisable strings.
        let ua = format!("utest1dev{}{:08}", match account { Account::Voting => "v", Account::Auction => "a" }, i);
        self.owned.insert(ua.clone(), account);
        Ok((ua, i.to_string()))
    }

    fn send(&mut self, from: Account, outputs: &[Output]) -> Result<String, BackendError> {
        if outputs.is_empty() {
            return Err(BackendError::BadRequest("no outputs".into()));
        }
        let need: u64 = outputs.iter().map(|o| o.amount_zat).sum::<u64>() + zip317_fee(outputs.len());
        let have = self.balance(from)?;
        if need > have {
            return Err(BackendError::InsufficientFunds { have, need });
        }
        let txid = self.txid();
        for (i, o) in outputs.iter().enumerate() {
            self.notes.push(IncomingNote {
                txid: txid.clone(),
                output_index: i as u32,
                height: self.tip + 1,
                value_zat: o.amount_zat,
                memo: o.memo.clone(),
                to_ua: o.to.clone(),
                pool: "orchard".into(),
            });
        }
        *self.spent.entry(from).or_insert(0) += need;
        Ok(txid)
    }

    fn scan_incoming(&mut self, from_height: u64) -> Result<Vec<IncomingNote>, BackendError> {
        Ok(self
            .notes
            .iter()
            .filter(|n| n.height >= from_height && n.height <= self.tip && self.owned.contains_key(&n.to_ua))
            .cloned()
            .collect())
    }

    fn balance(&mut self, account: Account) -> Result<u64, BackendError> {
        let received: u64 = self
            .notes
            .iter()
            .filter(|n| n.height <= self.tip && n.pool == "orchard" && self.owned.get(&n.to_ua) == Some(&account))
            .map(|n| n.value_zat)
            .sum();
        Ok(received - self.spent.get(&account).copied().unwrap_or(0))
    }

    fn dev(&mut self) -> Option<&mut DevBackend> {
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payments_land_in_the_next_block_and_only_ours_are_scanned() {
        let mut b = DevBackend::new(100);
        let (ua, _) = b.new_address(Account::Voting).unwrap();
        b.pay(&ua, 5_000_000, Some("obscura:v0:v:r0001:a".into()));
        b.pay("utest1someoneelse", 1, None);
        assert!(b.scan_incoming(0).unwrap().is_empty());
        b.mine(1);
        let notes = b.scan_incoming(0).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].height, 101);
        assert_eq!(b.balance(Account::Voting).unwrap(), 5_000_000);
    }

    #[test]
    fn addresses_are_never_reused() {
        let mut b = DevBackend::new(0);
        let a = b.new_address(Account::Auction).unwrap().0;
        let c = b.new_address(Account::Auction).unwrap().0;
        assert_ne!(a, c);
    }

    #[test]
    fn send_charges_the_zip317_fee_and_refuses_overdraft() {
        let mut b = DevBackend::new(0);
        let (ua, _) = b.new_address(Account::Auction).unwrap();
        b.pay(&ua, 1_000_000, None);
        b.mine(1);
        let out = [Output { to: "utest1bidder".into(), amount_zat: 990_000, memo: None }];
        b.send(Account::Auction, &out).unwrap();
        assert_eq!(b.balance(Account::Auction).unwrap(), 0);
        assert!(matches!(b.send(Account::Auction, &out), Err(BackendError::InsufficientFunds { .. })));
    }
}
