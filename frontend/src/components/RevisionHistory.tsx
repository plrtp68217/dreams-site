import { useState } from "react";
import type { Revision } from "../api/types";
import { formatDate } from "../lib/labels";
import { ScenarioContent } from "./ScenarioContent";

interface Props {
  revisions: Revision[];
  currentVersion: number;
  canRestore: boolean;
  onRestore: (revision: Revision) => Promise<unknown>;
}

export function RevisionHistory({ revisions, currentVersion, canRestore, onRestore }: Props) {
  const [selected, setSelected] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!revisions.length) return <p className="muted">Правок пока не было — это исходная версия.</p>;

  return (
    <>
      <ul className="rev-list">
        <li className="current">Версия {currentVersion} — текущая</li>
        {revisions.map((r) => (
          <li key={r.id}>
            <span>Версия {r.version}</span>
            <span className="muted small">
              {formatDate(r.created_at)} · {r.author?.display_name ?? "исходный импорт"}
            </span>
            <button type="button" className="btn small" onClick={() => setSelected(r)}>
              Посмотреть
            </button>
            {canRestore && (
              <button
                type="button"
                className="btn small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onRestore(r);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Восстановить
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="error-box" role="alert">{error}</div>}
      {selected && (
        <section aria-label={`Версия ${selected.version}`}>
          <h3>
            Версия {selected.version}: {selected.title}
          </h3>
          <div className="preview">
            <ScenarioContent html={selected.html} />
          </div>
          <details className="cheatsheet">
            <summary>Текст версии (Markdown)</summary>
            <pre className="revision-source">{selected.content}</pre>
          </details>
        </section>
      )}
    </>
  );
}
