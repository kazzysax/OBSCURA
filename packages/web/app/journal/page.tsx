import { SurvivalPill } from "@/components/SurvivalPill";
import { ctx } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Journal() {
  const entries = ctx().store.journal(100);
  return (
    <div>
      <h1>Journal</h1>
      <p className="muted">The artist writes before every round: what it learned, what it's afraid of, which whispers it followed.</p>
      {entries.length === 0 && <p className="muted">No entries yet.</p>}
      {entries.map((e) => (
        <article key={e.id} className="journal-entry">
          <div className="row small muted" style={{ marginBottom: 8 }}>
            <span>{new Date(e.createdAt).toUTCString()}</span>
            {e.roundId && <span className="pill">{e.roundId}</span>}
            <SurvivalPill state={e.survivalState} />
          </div>
          <h2>{e.title}</h2>
          <div className="body">
            {e.body.split(/\n+/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {e.whispers.length > 0 && (
            <p className="small muted">
              Whispers considered:{" "}
              {e.whispers.map((w, i) => (
                <span key={i}>
                  {i > 0 && ", "}“{w.text}” {w.used ? "(followed)" : "(set aside)"}
                </span>
              ))}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
