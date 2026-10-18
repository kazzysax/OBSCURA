export function roundId(n: number): string {
  return "r" + String(n).padStart(4, "0");
}

export function auctionId(n: number): string {
  return "a" + String(n).padStart(4, "0");
}

export function pieceId(roundIdStr: string, candidateId: string): string {
  return `${roundIdStr}-${candidateId}`;
}

export function roundNumber(id: string): number {
  return Number(id.slice(1));
}
