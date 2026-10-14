import { useRef, useState } from "react";
import { api } from "../api/client";
import type { User, UserBrief } from "../api/types";

type Person = Pick<UserBrief, "id" | "display_name"> & { avatar?: string | null };

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** A stable colour per person, so the same initials always look the same. */
function hue(id: number): number {
  return (id * 137) % 360;
}

/** The user's picture, or their initials on a coloured square. Decorative: the name is always shown next to it. */
export function Avatar({ user, size = 28 }: { user: Person | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (user?.avatar) return <img className="avatar" src={user.avatar} alt="" aria-hidden="true" style={style} />;
  return (
    <span
      className="avatar"
      aria-hidden="true"
      // drawn by CSS, so the letters do not end up in labels and copied text next to the name
      data-initials={user ? initials(user.display_name) : "?"}
      style={{ ...style, background: user ? `hsl(${hue(user.id)} 40% 42%)` : undefined }}
    />
  );
}

/** Upload or remove a user's picture (own, or anyone's for an admin). */
export function AvatarEditor({ user, onChange }: { user: User; onChange: (user: User) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<User>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-editor">
      <Avatar user={user} size={64} />
      <div className="btn-row">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          aria-label={`Аватарка ${user.username}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(() => api.setAvatar(user.id, file));
          }}
        />
        <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
          {user.avatar ? "Сменить аватарку" : "Загрузить аватарку"}
        </button>
        {user.avatar && (
          <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.removeAvatar(user.id))}>
            Убрать
          </button>
        )}
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
    </div>
  );
}
