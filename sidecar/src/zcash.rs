//! Real Zcash backend: a librustzcash light wallet (zcash_client_backend + zcash_client_sqlite)
//! talking to a lightwalletd server over gRPC. Patterns follow zcash/zcash-devtool, which pins the
//! same crate versions.
//!
//! Wallet directory layout (all gitignored, keep it private):
//!   seed.hex       32 random bytes, mode 0600 — the root of both accounts
//!   accounts.json  account uuids for "voting" (ZIP-32 account 0) and "auction" (account 1)
//!   wallet.sqlite  zcash_client_sqlite wallet database

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use rand::{rand_core::UnwrapErr, rngs::SysRng, RngExt};
use secrecy::{ExposeSecret, SecretVec};
use serde::{Deserialize, Serialize};
use tonic::transport::{Channel, ClientTlsConfig};
use tonic::Code;
use uuid::Uuid;

use zcash_address::ZcashAddress;
use zcash_client_backend::data_api::chain::{error::Error as ChainError, BlockCache, BlockSource};
use zcash_client_backend::data_api::scanning::ScanRange;
use zcash_client_backend::data_api::wallet::{
    create_proposed_transactions, decrypt_and_store_transaction,
    input_selection::{GreedyInputSelector, SpendPolicy},
    propose_transfer, ConfirmationsPolicy, SpendingKeys,
};
use zcash_client_backend::data_api::{
    Account as _, AccountBirthday, TransactionDataRequest, TransactionStatus, WalletRead, WalletWrite,
};
use zcash_client_backend::fees::{standard::MultiOutputChangeStrategy, DustOutputPolicy, SplitPolicy, StandardFeeRule};
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_client_backend::proto::service::{self, compact_tx_streamer_client::CompactTxStreamerClient};
use zcash_client_backend::wallet::OvkPolicy;
use zcash_client_sqlite::{util::SystemClock, wallet::init::init_wallet_db, AccountUuid, WalletDb};
use zcash_keys::keys::{ReceiverRequirement, UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::consensus::{BlockHeight, BranchId, Network, NetworkUpgrade, Parameters};
use zcash_protocol::memo::{Memo, MemoBytes};
use zcash_protocol::value::Zatoshis;
use zcash_protocol::ShieldedPool;
use zip321::{Payment, TransactionRequest};

use crate::backend::{Account, Backend, BackendError, IncomingNote, Output};

type Db = WalletDb<rusqlite::Connection, Network, SystemClock, UnwrapErr<SysRng>>;

const BATCH_SIZE: u32 = 1_000;
/// Don't hammer the server: sync at most this often.
const SYNC_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Serialize, Deserialize)]
struct Accounts {
    network: String,
    voting: Uuid,
    auction: Uuid,
}

pub struct ZcashConfig {
    pub wallet_dir: PathBuf,
    pub network: Network,
    /// e.g. https://testnet.zec.rocks:443
    pub lightwalletd: String,
}

pub struct ZcashBackend {
    cfg: ZcashConfig,
    rt: tokio::runtime::Runtime,
    db: Db,
    accounts: Accounts,
    cache: MemCache,
    last_sync: Option<Instant>,
}

fn err<E: std::fmt::Display>(e: E) -> BackendError {
    BackendError::Unavailable(e.to_string())
}

fn network_name(n: Network) -> &'static str {
    match n {
        Network::MainNetwork => "mainnet",
        Network::TestNetwork => "testnet",
    }
}

async fn connect(endpoint: &str) -> Result<CompactTxStreamerClient<Channel>, BackendError> {
    let channel = Channel::from_shared(endpoint.to_string()).map_err(err)?;
    let channel = if endpoint.starts_with("https://") {
        let host = endpoint.trim_start_matches("https://").split(':').next().unwrap_or_default().to_string();
        let tls = ClientTlsConfig::new().domain_name(host).assume_http2(true).with_webpki_roots();
        channel.tls_config(tls).map_err(err)?
    } else {
        channel
    };
    Ok(CompactTxStreamerClient::new(channel.connect().await.map_err(err)?))
}

fn read_seed(dir: &Path) -> Result<SecretVec<u8>, BackendError> {
    let hex_seed = fs::read_to_string(dir.join("seed.hex")).map_err(err)?;
    let bytes = hex::decode(hex_seed.trim()).map_err(err)?;
    Ok(SecretVec::new(bytes))
}

fn open_db(dir: &Path, network: Network) -> Result<Db, BackendError> {
    WalletDb::for_path(dir.join("wallet.sqlite"), network, SystemClock, UnwrapErr(SysRng)).map_err(err)
}

/// Create a new wallet: seed, database, and the two accounts with a birthday just below the tip.
pub fn init_wallet(cfg: &ZcashConfig) -> Result<(), BackendError> {
    let dir = &cfg.wallet_dir;
    if dir.join("seed.hex").exists() {
        return Err(BackendError::BadRequest(format!("wallet already exists in {}", dir.display())));
    }
    // Talk to the server first, so a network failure doesn't leave a half-made wallet behind.
    let rt = tokio::runtime::Runtime::new().map_err(err)?;
    let birthday = rt.block_on(async {
        let mut client = connect(&cfg.lightwalletd).await?;
        let tip: u64 = client.get_latest_block(service::ChainSpec::default()).await.map_err(err)?.into_inner().height;
        // The birthday is the chain state as of the block *before* the birthday height.
        let birthday_height = tip.saturating_sub(10);
        let request = service::BlockId { height: birthday_height - 1, ..Default::default() };
        let treestate = client.get_tree_state(request).await.map_err(err)?.into_inner();
        AccountBirthday::from_treestate(treestate, None).map_err(|e| err(format!("{e:?}")))
    })?;

    fs::create_dir_all(dir).map_err(err)?;
    let mut seed = [0u8; 32];
    rand::rng().fill(&mut seed);
    write_private(&dir.join("seed.hex"), &hex::encode(seed))?;
    let seed = SecretVec::new(seed.to_vec());

    let mut db = open_db(dir, cfg.network)?;
    init_wallet_db(&mut db, None).map_err(|e| err(format!("{e:?}")))?;
    // create_account picks the next ZIP-32 index: 0 then 1.
    let (voting, _) = db.create_account("voting", &seed, &birthday, None).map_err(err)?;
    let (auction, _) = db.create_account("auction", &seed, &birthday, None).map_err(err)?;
    let accounts = Accounts { network: network_name(cfg.network).into(), voting: voting.expose_uuid(), auction: auction.expose_uuid() };
    fs::write(dir.join("accounts.json"), serde_json::to_string_pretty(&accounts).unwrap()).map_err(err)?;
    eprintln!("obscura-sidecar: new {} wallet in {} (birthday {})", accounts.network, dir.display(), u32::from(birthday.height()));
    Ok(())
}

fn write_private(path: &Path, contents: &str) -> Result<(), BackendError> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path).map_err(err)?;
        f.write_all(contents.as_bytes()).map_err(err)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, contents).map_err(err)
    }
}

impl ZcashBackend {
    pub fn open(cfg: ZcashConfig) -> Result<Self, BackendError> {
        let accounts: Accounts = serde_json::from_str(&fs::read_to_string(cfg.wallet_dir.join("accounts.json")).map_err(err)?).map_err(err)?;
        if accounts.network != network_name(cfg.network) {
            return Err(BackendError::BadRequest(format!("wallet is for {}, not {}", accounts.network, network_name(cfg.network))));
        }
        let mut db = open_db(&cfg.wallet_dir, cfg.network)?;
        init_wallet_db(&mut db, None).map_err(|e| err(format!("{e:?}")))?; // runs pending migrations
        Ok(ZcashBackend { rt: tokio::runtime::Runtime::new().map_err(err)?, db, accounts, cache: MemCache::default(), last_sync: None, cfg })
    }

    fn account_uuid(&self, a: Account) -> AccountUuid {
        AccountUuid::from_uuid(match a {
            Account::Voting => self.accounts.voting,
            Account::Auction => self.accounts.auction,
        })
    }

    /// Scan new blocks, then fetch full transactions so memos are available ("enhancement").
    fn sync(&mut self, force: bool) -> Result<(), BackendError> {
        if !force && self.last_sync.is_some_and(|t| t.elapsed() < SYNC_INTERVAL) {
            return Ok(());
        }
        let network = self.cfg.network;
        let endpoint = self.cfg.lightwalletd.clone();
        let db = &mut self.db;
        let cache = &self.cache;
        self.rt.block_on(async {
            let mut client = connect(&endpoint).await?;
            zcash_client_backend::sync::run(&mut client, &network, cache, db, BATCH_SIZE)
                .await
                .map_err(|e| err(format!("sync: {e}")))?;
            enhance(&mut client, &network, db).await
        })?;
        self.last_sync = Some(Instant::now());
        Ok(())
    }
}

async fn fetch_tx(
    client: &mut CompactTxStreamerClient<Channel>,
    params: &Network,
    tip: BlockHeight,
    txid: TxId,
) -> Result<Option<(Transaction, Option<BlockHeight>)>, BackendError> {
    let req = service::TxFilter { hash: txid.as_ref().to_vec(), ..Default::default() };
    let raw = match client.get_transaction(req).await {
        Ok(r) => r.into_inner(),
        Err(s) if s.code() == Code::NotFound => return Ok(None),
        Err(s) => return Err(err(s)),
    };
    let mined = (raw.height > 0 && raw.height <= u64::from(u32::MAX)).then(|| BlockHeight::from_u32(raw.height as u32));
    let tx = Transaction::read(&raw.data[..], BranchId::for_height(params, mined.unwrap_or(tip))).map_err(err)?;
    Ok(Some((tx, mined)))
}

/// Satisfy the wallet's transaction data requests (as in zcash-devtool's `enhance`).
async fn enhance(client: &mut CompactTxStreamerClient<Channel>, params: &Network, db: &mut Db) -> Result<(), BackendError> {
    let Some(tip) = db.chain_height().map_err(err)? else { return Ok(()) };
    let mut done = BTreeSet::new();
    loop {
        let mut progressed = false;
        for request in db.transaction_data_requests().map_err(err)? {
            if !done.insert(request.clone()) {
                continue;
            }
            progressed = true;
            match &request {
                TransactionDataRequest::GetStatus(txid) => {
                    let status = fetch_tx(client, params, tip, *txid).await?.map_or(TransactionStatus::TxidNotRecognized, |(_, h)| {
                        h.map_or(TransactionStatus::NotInMainChain, TransactionStatus::Mined)
                    });
                    db.set_transaction_status(*txid, status).map_err(err)?;
                }
                TransactionDataRequest::Enhancement(txid) => match fetch_tx(client, params, tip, *txid).await? {
                    None => db.set_transaction_status(*txid, TransactionStatus::TxidNotRecognized).map_err(err)?,
                    Some((tx, mined)) => decrypt_and_store_transaction(params, db, &tx, mined).map_err(err)?,
                },
            }
        }
        if !progressed {
            return Ok(());
        }
    }
}

impl Backend for ZcashBackend {
    fn tip(&mut self) -> Result<u64, BackendError> {
        self.sync(false)?;
        Ok(self.db.chain_height().map_err(err)?.map_or(0, u64::from))
    }

    fn new_address(&mut self, account: Account) -> Result<(String, String), BackendError> {
        let request = UnifiedAddressRequest::custom(ReceiverRequirement::Require, ReceiverRequirement::Omit, ReceiverRequirement::Omit)
            .map_err(|e| err(format!("{e:?}")))?;
        let (ua, idx) = self
            .db
            .get_next_available_address(self.account_uuid(account), request)
            .map_err(err)?
            .ok_or_else(|| err("account not found"))?;
        Ok((ua.encode(&self.cfg.network), format!("{}", u128::from(idx))))
    }

    fn send(&mut self, from: Account, outputs: &[Output]) -> Result<String, BackendError> {
        if outputs.is_empty() {
            return Err(BackendError::BadRequest("no outputs".into()));
        }
        self.sync(true)?;
        let payments = outputs
            .iter()
            .map(|o| {
                let addr = ZcashAddress::from_str(&o.to).map_err(|e| BackendError::BadRequest(format!("bad address: {e}")))?;
                let value = Zatoshis::from_u64(o.amount_zat).map_err(|_| BackendError::BadRequest("bad amount".into()))?;
                let memo = o
                    .memo
                    .as_deref()
                    .map(|m| Memo::from_str(m).map(MemoBytes::from).map_err(|_| BackendError::BadRequest("memo too long".into())))
                    .transpose()?;
                Payment::new(addr, Some(value), memo, None, None, vec![]).map_err(|e| BackendError::BadRequest(format!("{e:?}")))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let request = TransactionRequest::new(payments).map_err(|e| BackendError::BadRequest(format!("{e:?}")))?;

        let account = self.account_uuid(from);
        let index = self
            .db
            .get_account(account)
            .map_err(err)?
            .and_then(|a| a.source().key_derivation().map(|d| d.account_index()))
            .ok_or_else(|| err("account has no spending key"))?;
        let seed = read_seed(&self.cfg.wallet_dir)?;
        let usk = UnifiedSpendingKey::from_seed(&self.cfg.network, seed.expose_secret(), index).map_err(|e| err(format!("{e:?}")))?;

        let change = MultiOutputChangeStrategy::new(
            StandardFeeRule::Zip317,
            None,
            ShieldedPool::Orchard,
            DustOutputPolicy::default(),
            SplitPolicy::with_min_output_value(NonZeroUsize::new(1).unwrap(), Zatoshis::from_u64(10_000_000).unwrap()),
        );
        let proposal = propose_transfer::<_, _, _, _, std::convert::Infallible>(
            &mut self.db,
            &self.cfg.network,
            account,
            &GreedyInputSelector::new(),
            &change,
            request,
            ConfirmationsPolicy::default(),
            &SpendPolicy::default(),
            None,
            None,
        )
        .map_err(|e| match e.to_string() {
            s if s.contains("Insufficient") => BackendError::InsufficientFunds { have: 0, need: outputs.iter().map(|o| o.amount_zat).sum() },
            s => err(s),
        })?;

        let prover = LocalTxProver::bundled();
        let txids = create_proposed_transactions::<_, _, std::convert::Infallible, _, std::convert::Infallible, _>(
            &mut self.db,
            &self.cfg.network,
            &SystemClock,
            &mut UnwrapErr(SysRng),
            &prover,
            &prover,
            &SpendingKeys::from_unified_spending_key(usk),
            OvkPolicy::Sender,
            &proposal,
            None,
        )
        .map_err(err)?;
        if txids.len() > 1 {
            return Err(err("multi-transaction proposals are not supported"));
        }
        let txid = *txids.first();
        let tx = self.db.get_transaction(txid).map_err(err)?.ok_or_else(|| err("created transaction not found"))?;
        let mut raw = service::RawTransaction::default();
        tx.write(&mut raw.data).map_err(err)?;
        let endpoint = self.cfg.lightwalletd.clone();
        let resp = self.rt.block_on(async {
            let mut client = connect(&endpoint).await?;
            client.send_transaction(raw).await.map_err(err).map(|r| r.into_inner())
        })?;
        if resp.error_code != 0 {
            return Err(err(format!("broadcast rejected ({}): {}", resp.error_code, resp.error_message)));
        }
        Ok(txid.to_string())
    }

    fn scan_incoming(&mut self, from_height: u64) -> Result<Vec<IncomingNote>, BackendError> {
        self.sync(false)?;
        let tip = self.db.chain_height().map_err(err)?.map_or(0, u64::from);
        // v_tx_outputs is zcash_client_sqlite's public view of every output the wallet knows about.
        // Incoming = received by one of our accounts, not created by us, not change.
        // A separate read-only connection: WalletDb doesn't expose its own.
        let conn = rusqlite::Connection::open_with_flags(self.cfg.wallet_dir.join("wallet.sqlite"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(err)?;
        let mut stmt = conn
            .prepare(
                "SELECT txid, tx_mined_height, output_pool, output_index, value, memo, to_address
                 FROM v_tx_outputs
                 WHERE to_account_uuid IS NOT NULL AND from_account_uuid IS NULL AND is_change = 0
                   AND tx_mined_height IS NOT NULL AND tx_mined_height >= ?1 AND tx_mined_height <= ?2
                 ORDER BY tx_mined_height, txid, output_index",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([from_height, tip], |r| {
                let txid: Vec<u8> = r.get(0)?;
                let height: u64 = r.get(1)?;
                let pool: i64 = r.get(2)?;
                let output_index: u32 = r.get(3)?;
                let value: u64 = r.get(4)?;
                let memo: Option<Vec<u8>> = r.get(5)?;
                let to_ua: Option<String> = r.get(6)?;
                Ok((txid, height, pool, output_index, value, memo, to_ua))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (txid, height, pool, output_index, value, memo, to_ua) = row.map_err(err)?;
            let txid = TxId::from_bytes(txid.try_into().map_err(|_| err("bad txid length"))?);
            let memo = memo.and_then(|m: Vec<u8>| MemoBytes::from_bytes(&m[..]).ok()).and_then(|m| match Memo::try_from(m) {
                Ok(Memo::Text(t)) => Some(String::from(t)),
                _ => None,
            });
            out.push(IncomingNote {
                txid: txid.to_string(),
                output_index,
                height,
                value_zat: value,
                memo,
                to_ua: to_ua.unwrap_or_default(),
                pool: match pool {
                    3 => "orchard",
                    2 => "sapling",
                    _ => "transparent",
                }
                .into(),
            });
        }
        Ok(out)
    }

    fn balance(&mut self, account: Account) -> Result<u64, BackendError> {
        self.sync(false)?;
        let summary = self.db.get_wallet_summary(ConfirmationsPolicy::default()).map_err(err)?;
        Ok(summary
            .and_then(|s| s.account_balances().get(&self.account_uuid(account)).map(|b| b.orchard_balance().spendable_value().into_u64()))
            .unwrap_or(0))
    }
}

// --- In-memory compact block cache for `sync::run` -------------------------------------------

#[derive(Default)]
pub struct MemCache {
    blocks: Mutex<BTreeMap<BlockHeight, CompactBlock>>,
}

#[derive(Debug)]
pub struct CacheError(String);
impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for CacheError {}

impl BlockSource for MemCache {
    type Error = CacheError;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), ChainError<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), ChainError<WalletErrT, Self::Error>>,
    {
        let blocks: Vec<CompactBlock> = {
            let map = self.blocks.lock().unwrap();
            let start = from_height.unwrap_or(BlockHeight::from_u32(0));
            map.range(start..).take(limit.unwrap_or(usize::MAX)).map(|(_, b)| b.clone()).collect()
        };
        for b in blocks {
            with_block(b)?;
        }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, Self::Error> {
        let map = self.blocks.lock().unwrap();
        Ok(match range {
            Some(r) => map.range(r.block_range().clone()).next_back().map(|(h, _)| *h),
            None => map.keys().next_back().copied(),
        })
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        Ok(self.blocks.lock().unwrap().range(range.block_range().clone()).map(|(_, b)| b.clone()).collect())
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut map = self.blocks.lock().unwrap();
        for b in compact_blocks {
            map.insert(b.height(), b);
        }
        Ok(())
    }

    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        let mut map = self.blocks.lock().unwrap();
        let keys: Vec<BlockHeight> = map.range(range.block_range().clone()).map(|(h, _)| *h).collect();
        for k in keys {
            map.remove(&k);
        }
        Ok(())
    }
}

#[allow(dead_code)]
fn _assert_nu7_known() -> Option<BlockHeight> {
    // The pre-release crates know testnet NU7 (activated at 4,465,026); stable ones don't.
    Network::TestNetwork.activation_height(NetworkUpgrade::Nu7)
}
