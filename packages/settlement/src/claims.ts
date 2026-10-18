// Claims (winner gets the piece + provenance certificate) and patron badges (docs/PROTOCOL.md §4–5).
// Identity never enters: the only proof is a signature from the key named in the memo.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  challengeString,
  generateKeyPair,
  isPubkeyHex,
  newNonce,
  pieceId,
  publicKeyOf,
  signCertificate,
  verifyMessage,
  type BadgeCertificate,
  type ChallengeKind,
  type ProvenanceCertificate,
} from "@obscura/core";
import type { Store } from "@obscura/store";

/** Load the artist's Ed25519 signing key, creating it (mode 0600) on first run. */
export function loadOrCreateArtistKey(path: string): { privateKey: string; publicKey: string } {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, generateKeyPair().privateKey + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const privateKey = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(privateKey)) throw new Error(`artist key at ${path} is not 32 bytes of hex`);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

export class ClaimError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function issueChallenge(store: Store, kind: ChallengeKind, targetId: string): { challenge: string; nonce: string } {
  if (kind === "claim") {
    const a = store.getAuction(targetId);
    if (!a || !a.winnerClaimPubkey) throw new ClaimError("no winning bid for this auction", 404);
  } else {
    const r = store.getRound(targetId);
    if (!r?.tally) throw new ClaimError("round not tallied yet", 404);
  }
  const nonce = newNonce();
  store.addChallenge(nonce, kind, targetId);
  return { challenge: challengeString(kind, targetId, nonce), nonce };
}

export interface ClaimResult {
  certificate: ProvenanceCertificate;
  imageFile: string;
  mime: string;
}

export function redeemClaim(
  store: Store,
  artistPrivateKey: string,
  req: { auctionId: string; nonce: string; signature: string },
): ClaimResult {
  const auction = store.getAuction(req.auctionId);
  if (!auction?.winnerClaimPubkey || auction.priceZat == null) throw new ClaimError("no winning bid for this auction", 404);
  // Verify before consuming, so a bad signature doesn't burn the winner's challenge.
  const challenge = challengeString("claim", req.auctionId, req.nonce);
  if (!verifyMessage(challenge, req.signature, auction.winnerClaimPubkey)) throw new ClaimError("signature does not match the winning bid's claim key", 403);
  if (!store.consumeChallenge(req.nonce, "claim", req.auctionId)) throw new ClaimError("challenge unknown, used or expired", 400);

  const cand = store.candidates(auction.roundId).find((c) => c.candidateId === auction.candidateId)!;
  const existing = store.getClaim(auction.id);
  const certificate =
    (existing?.certificate as ProvenanceCertificate | undefined) ??
    signCertificate<ProvenanceCertificate>(
      {
        type: "obscura.provenance.v0",
        piece_id: pieceId(auction.roundId, auction.candidateId),
        round_id: auction.roundId,
        auction_id: auction.id,
        price_zat: auction.priceZat,
        claim_pubkey: auction.winnerClaimPubkey,
        image_sha256: cand.imageSha256,
      },
      artistPrivateKey,
    );
  if (!existing) store.saveClaim(auction.id, auction.winnerClaimPubkey, certificate);
  return { certificate, imageFile: cand.imageFile, mime: cand.mime };
}

export function redeemBadge(
  store: Store,
  artistPrivateKey: string,
  req: { roundId: string; patronPubkey: string; nonce: string; signature: string },
): BadgeCertificate {
  if (!isPubkeyHex(req.patronPubkey)) throw new ClaimError("bad patron key", 400);
  const round = store.getRound(req.roundId);
  if (!round?.tally) throw new ClaimError("round not tallied yet", 404);
  const backed = Object.entries(round.tally.badgeRegistry).find(([, keys]) => keys.includes(req.patronPubkey));
  if (!backed) throw new ClaimError("this key did not back any piece in this round", 404);
  const challenge = challengeString("badge", req.roundId, req.nonce);
  if (!verifyMessage(challenge, req.signature, req.patronPubkey)) throw new ClaimError("signature does not match the patron key", 403);
  if (!store.consumeChallenge(req.nonce, "badge", req.roundId)) throw new ClaimError("challenge unknown, used or expired", 400);
  const [candidateId] = backed;
  const cert = signCertificate<BadgeCertificate>(
    {
      type: "obscura.badge.v0",
      round_id: req.roundId,
      candidate_id: candidateId,
      won: round.winner === candidateId,
      patron_pubkey: req.patronPubkey,
    },
    artistPrivateKey,
  );
  store.saveBadge(req.roundId, req.patronPubkey, candidateId, cert);
  return cert;
}
