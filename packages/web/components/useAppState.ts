"use client";
import { useEffect, useState } from "react";
import type { AppState } from "@/lib/view";

/** Poll /api/state so tallies, blocks and auctions update live. */
export function useAppState(initial: AppState, intervalMs = 3000): AppState {
  const [state, setState] = useState(initial);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (res.ok && alive) setState(await res.json());
      } catch {
        // keep the last good state
      }
    };
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return state;
}
