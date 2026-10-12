const KEY = "snyi-theme";
type Theme = "light" | "dark";

function read(): Theme | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function applySavedTheme() {
  const saved = read();
  if (saved) document.documentElement.setAttribute("data-theme", saved);
}

export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
