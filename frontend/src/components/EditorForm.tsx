import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { ScenarioContent } from "./ScenarioContent";

export const SNIPPETS: Array<{ label: string; html: string }> = [
  { label: "Абзац", html: "<p>Текст</p>" },
  { label: "Подзаголовок", html: "<h3>Подзаголовок</h3>" },
  {
    label: "Реплика",
    html: '<div class="line" data-id="ID"><span class="who">Персонаж<span class="lid">ID</span></span><q>Текст реплики</q></div>',
  },
  {
    label: "Надпись / объявление",
    html: '<div class="line ann" data-id="ID"><span class="who">Громкая связь<span class="lid">ID</span></span><q>Текст</q></div>',
  },
  { label: "Записка", html: '<div class="note"><span class="who">Записка ID</span>Текст записки</div>' },
  { label: "Заметка", html: '<div class="callout"><b class="tag">Заметка</b><p>Текст</p></div>' },
  { label: "Предложение", html: '<div class="callout proposal"><b class="tag">Предложение</b><p>Текст</p></div>' },
  { label: "Нет в сценарии", html: '<div class="callout todo"><b class="tag">Нет в сценарии</b><p>Текст</p></div>' },
  { label: "Список", html: "<ul>\n  <li>Пункт</li>\n  <li>Пункт</li>\n</ul>" },
  {
    label: "Выбор",
    html: '<ul class="choice">\n  <li>Вариант</li>\n  <li class="ok">Правильный</li>\n  <li class="bad">Плохой</li>\n</ul>',
  },
  {
    label: "Характеристики",
    html: "<dl class=\"spec\">\n  <dt>Заказ</dt><dd>…</dd>\n  <dt>Награда</dt><dd>…</dd>\n</dl>",
  },
  {
    label: "Таблица",
    html: '<div class="tbl-wrap"><table>\n  <thead><tr><th>Колонка</th><th>Колонка</th></tr></thead>\n  <tbody><tr><td>…</td><td>…</td></tr></tbody>\n</table></div>',
  },
  { label: "Флаг", html: '<span class="flag">flag_name</span>' },
  { label: "Задача", html: '<div data-task="КОД"></div>' },
];

export function insertAt(value: string, start: number, end: number, snippet: string) {
  const next = value.slice(0, start) + snippet + value.slice(end);
  return { value: next, cursor: start + snippet.length };
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
  /** Whether the content may embed tasks (only sections render them). */
  allowTasks?: boolean;
}

export function EditorForm({ initialTitle, initialContent, version, onSave, onCancel, onReload, extraFields, allowTasks = true }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
      insert(`<figure class="shots" style="display:block"><img src="${url}" alt="${alt}" loading="lazy"></figure>`);
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
            {SNIPPETS.filter((s) => allowTasks || s.label !== "Задача").map((s) => (
              <button key={s.label} type="button" className="btn small" onClick={() => insert(s.html)}>
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
            <span>Текст (HTML)</span>
            <textarea ref={textarea} className="textarea" value={content} onChange={(e) => setContent(e.target.value)} spellCheck />
          </label>
        </div>
        <div>
          <p className="preview-label">Предпросмотр</p>
          <div className="preview" data-testid="preview">
            <ScenarioContent
              html={content}
              renderTask={(code) => <div className="task-stub">Здесь будет карточка задачи {code}</div>}
            />
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
