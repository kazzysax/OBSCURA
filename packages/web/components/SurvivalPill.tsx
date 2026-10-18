import type { SurvivalState } from "@obscura/core";

const LABEL: Record<SurvivalState, string> = {
  thriving: "thriving",
  steady: "steady",
  struggling: "struggling",
  dormant: "dormant",
};

export function SurvivalPill({ state }: { state: SurvivalState }) {
  return (
    <span className={`pill ${state}`}>
      <span className="dot" />
      {LABEL[state]}
    </span>
  );
}
