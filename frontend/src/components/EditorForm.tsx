import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { ScenarioContent } from "./ScenarioContent";

/** Toolbar blocks, in scenario Markdown (see backend app/markup.py). */
export const SNIPPETS: Array<{ label: string; text: string; hint: string }> = [
  { label: "Подзаголовок", text: "### Подзаголовок\n", hint: "### Подзаголовок" },
  { label: "Реплика", text: "> **Персонаж:** Текст реплики\n", hint: "> **Клоун:** Ты заказала это сама." },
  {
    label: "Надпись / объявление",
    text: "> *Громкая связь:* Текст\n",
    hint: "> *Табличка на двери:* Склад замороженных решений",
  },
  { label: "Записка", text: "::: записка Записка\nТекст записки\n:::\n", hint: "::: записка Подпись … :::" },
  { label: "Заметка", text: "::: заметка Заголовок\nТекст\n:::\n", hint: "::: заметка Заголовок … :::" },
  {
    label: "Нет в сценарии",
    text: "::: нет-в-сценарии Что нужно решить\nТекст\n:::\n",
    hint: "::: нет-в-сценарии Заголовок … :::",
  },
  { label: "Карточка", text: "::: карточка Название\nОписание\n:::\n", hint: "::: карточка Название … :::" },
  { label: "Список", text: "- Пункт\n- Пункт\n", hint: "- пункт" },
  {
    label: "Выбор",
    text: "::: выбор\n- Вариант\n- (+) Правильный\n- (-) Плохой\n:::\n",
    hint: "(+) правильный, (-) плохой",
  },
  {
    label: "Характеристики",
    text: "::: характеристики\nЗаказ: …\nНаграда: …\n:::\n",
    hint: "Термин: значение — по строке",
  },
  {
    label: "Таблица",
    text: "| Колонка | Колонка |\n| --- | --- |\n| … | … |\n",
    hint: "| a | b | / | --- | --- |",
  },
  { label: "Флаг", text: "`flag_name`", hint: "`ff_side_done`" },
];

const CHEATSHEET: Array<[string, string]> = [
  ["**жирный**, *курсив*", "выделение"],
  ["[текст](#ff-final)", "ссылка на место в сценарии"],
  ["![подпись](/media/x.jpg \"под картинкой\")", "картинка; несколько подряд — галерея"],
  ["::: вводка … :::", "вступительный абзац раздела"],
  ["::: этапы / ::: дневник", "пункты начинаются с #### Заголовок"],
  ["```mermaid … ```", "схема"],
  ["пустая строка", "новый абзац"],
];

export function insertAt(value: string, start: number, end: number, snippet: string) {
  // blocks go on their own line
  const block = snippet.endsWith("\n");
  const before = value.slice(0, start);
  const lead = block && before && !before.endsWith("\n") ? "\n" : "";
  const text = lead + snippet;
  return { value: before + text + value.slice(end), cursor: start + text.length };
}

/** Server-rendered preview, so it looks exactly like the saved text. */
function usePreview(source: string) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.render(source).then(
        (r) => {
          if (!alive) return;
          setHtml(r.html);
          setError(null);
        },
        (e: Error) => alive && setError(e.message),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [source]);
  return { html, error };
}

interface Props {
  initialTitle: string;
  initialContent: string;
  version: number;
  /** Persist; must throw ApiError(409) when the version is stale. */
  onSave: (title: string, content: string, version: number) => Promise<unknown>;
  onCancel: () => void;
  onReload: () => void;
  extraFields?: ReactNode;
}

export function EditorForm({ initialTitle, initialContent, version, onSave, onCancel, onReload, extraFields }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = usePreview(content);
  const dirty = title !== initialTitle || content !== initialContent;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const insert = (snippet: string) => {
    const el = textarea.current;
    const start = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? content.length;
    const res = insertAt(content, start, end, snippet);
    setContent(res.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(res.cursor, res.cursor);
    });
  };

  const save = async (baseVersion: number) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(title, content, baseVersion);
      setConflictVersion(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const detail = e.detail as { current_version?: number } | undefined;
        setConflictVersion(detail?.current_version ?? null);
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(version);
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.upload(file);
      const alt = file.name.replace(/\.[^.]+$/, "");
      insert(`![${alt}](${url})\n`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="field">
        <span>Заголовок</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
      </label>
      {extraFields}

      {error && (
        <div className="error-box" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
          {conflictVersion !== null && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className="btn danger" onClick={() => save(conflictVersion)}>
                Сохранить поверх чужой правки
              </button>
              <button type="button" className="btn" onClick={onReload}>
                Отменить мои правки и загрузить свежую версию
              </button>
            </div>
          )}
        </div>
      )}

      <div className="editor-grid">
        <div>
          <div className="toolbar" role="toolbar" aria-label="Вставить блок">
            {SNIPPETS.map((s) => (
              <button key={s.label} type="button" className="btn small" title={s.hint} onClick={() => insert(s.text)}>
                {s.label}
              </button>
            ))}
            <button type="button" className="btn small" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? "Загрузка…" : "Изображение"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              data-testid="image-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </div>
          <label className="field">
            <span>Текст (Markdown)</span>
            <textarea
              ref={textarea}
              className="textarea markdown"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck
            />
          </label>
          <details className="cheatsheet">
            <summary>Шпаргалка по разметке</summary>
            <dl>
              {SNIPPETS.filter((s) => s.hint.startsWith(">") || s.hint.startsWith(":::")).map((s) => (
                <div key={s.label}>
                  <dt>
                    <code>{s.hint}</code>
                  </dt>
                  <dd>{s.label.toLowerCase()}</dd>
                </div>
              ))}
              {CHEATSHEET.map(([code, what]) => (
                <div key={code}>
                  <dt>
                    <code>{code}</code>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
        <div>
          <p className="preview-label">Предпросмотр</p>
          <div className="preview" data-testid="preview" aria-busy={preview.html === null}>
            {preview.error ? (
              <p className="muted small" role="status">
                Предпросмотр недоступен: {preview.error}
              </p>
            ) : preview.html === null ? (
              <p className="muted small">Загрузка…</p>
            ) : (
              <ScenarioContent html={preview.html} />
            )}
          </div>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="submit" className="btn primary" disabled={saving || !dirty}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        {!dirty && <span className="muted small">Нет изменений</span>}
      </div>
    </form>
  );
}
