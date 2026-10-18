//! Obscura sidecar: the only process that holds spend keys.
//!
//! HTTP API (JSON), matched by `SidecarClient` in packages/detector:
//!   GET  /tip                         -> {height}
//!   POST /new_address   {account}     -> {ua, diversifier_index}
//!   POST /send          {from, outputs: [{to, amount_zat, memo}]} -> {txid}
//!   GET  /scan_incoming ?from_height  -> [{txid, output_index, height, value_zat, memo, to_ua, pool}]
//!   GET  /balance       ?account      -> {orchard_zat}
//! Dev backend only:
//!   POST /dev/pay       {to, value_zat, memo} -> {txid}
//!   POST /dev/mine      {blocks}      -> {height}
//!
//! Binds to 127.0.0.1 only. The backend (librustzcash vs zingo-cli) is chosen by the spike;
//! see docs/SPIKE.md. Until then `SIDECAR_BACKEND=dev` (the default) runs an in-memory chain.

mod backend;

use backend::{Account, Backend, BackendError, DevBackend, Output};
use serde::Deserialize;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Request, Response, Server};

#[derive(Deserialize)]
struct NewAddress {
    account: Account,
}

#[derive(Deserialize)]
struct Send {
    from: Account,
    outputs: Vec<Output>,
}

#[derive(Deserialize)]
struct DevPay {
    to: String,
    value_zat: u64,
    memo: Option<String>,
}

#[derive(Deserialize)]
struct DevMine {
    blocks: u64,
}

fn query(url: &str, key: &str) -> Option<String> {
    url.split_once('?')?.1.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| v.to_string())
    })
}

fn body<T: for<'de> Deserialize<'de>>(req: &mut Request) -> Result<T, BackendError> {
    let mut s = String::new();
    req.as_reader().read_to_string(&mut s).map_err(|e| BackendError::BadRequest(e.to_string()))?;
    serde_json::from_str(&s).map_err(|e| BackendError::BadRequest(e.to_string()))
}

fn route(req: &mut Request, backend: &mut dyn Backend) -> Result<Value, BackendError> {
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("");
    match (req.method(), path) {
        (Method::Get, "/tip") => Ok(json!({ "height": backend.tip()? })),
        (Method::Post, "/new_address") => {
            let b: NewAddress = body(req)?;
            let (ua, idx) = backend.new_address(b.account)?;
            Ok(json!({ "ua": ua, "diversifier_index": idx }))
        }
        (Method::Post, "/send") => {
            let b: Send = body(req)?;
            Ok(json!({ "txid": backend.send(b.from, &b.outputs)? }))
        }
        (Method::Get, "/scan_incoming") => {
            let from = query(&url, "from_height").and_then(|v| v.parse().ok()).unwrap_or(0);
            Ok(serde_json::to_value(backend.scan_incoming(from)?).unwrap())
        }
        (Method::Get, "/balance") => {
            let account: Account = serde_json::from_value(json!(query(&url, "account").unwrap_or_default()))
                .map_err(|_| BackendError::BadRequest("account must be voting|auction".into()))?;
            Ok(json!({ "orchard_zat": backend.balance(account)? }))
        }
        (Method::Post, "/dev/pay") => {
            let b: DevPay = body(req)?;
            let dev = backend.dev().ok_or_else(|| BackendError::BadRequest("dev endpoints are disabled".into()))?;
            Ok(json!({ "txid": dev.pay(&b.to, b.value_zat, b.memo) }))
        }
        (Method::Post, "/dev/mine") => {
            let b: DevMine = body(req)?;
            let dev = backend.dev().ok_or_else(|| BackendError::BadRequest("dev endpoints are disabled".into()))?;
            Ok(json!({ "height": dev.mine(b.blocks) }))
        }
        _ => Err(BackendError::BadRequest(format!("no route {path}"))),
    }
}

fn main() {
    let port = std::env::var("SIDECAR_PORT").unwrap_or_else(|_| "8402".into());
    let kind = std::env::var("SIDECAR_BACKEND").unwrap_or_else(|_| "dev".into());
    if kind != "dev" {
        eprintln!("obscura-sidecar: backend '{kind}' is not implemented yet (see docs/SPIKE.md); use SIDECAR_BACKEND=dev");
        std::process::exit(2);
    }
    let mut backend: Box<dyn Backend> = Box::new(DevBackend::new(1000));
    let server = Server::http(format!("127.0.0.1:{port}")).expect("bind sidecar port");
    eprintln!("obscura-sidecar: dev backend listening on 127.0.0.1:{port}");
    let json_header = Header::from_bytes("content-type", "application/json").unwrap();

    for mut req in server.incoming_requests() {
        let result = route(&mut req, backend.as_mut());
        let (status, payload) = match result {
            Ok(v) => (200, v),
            Err(e @ BackendError::BadRequest(_)) => (400, json!({ "error": e.to_string() })),
            Err(e @ BackendError::InsufficientFunds { .. }) => (409, json!({ "error": e.to_string() })),
            Err(e @ BackendError::Unavailable(_)) => (503, json!({ "error": e.to_string() })),
        };
        let resp = Response::from_string(payload.to_string()).with_status_code(status).with_header(json_header.clone());
        let _ = req.respond(resp);
    }
}
