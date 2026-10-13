/**
 * Places in the scenario a task can point at: headings, dialogue lines, notes, callouts and cards.
 * The server gives each of them a hidden data-id (cards keep their old id), see backend html_utils.ensure_anchor_ids.
 */
export interface Place {
  anchor: string;
  label: string;
  /** Nesting inside a card, for indenting the picker. */
  depth: number;
}

const MAX = 70;

function clip(text: string, max = MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function textWithout(el: Element, selector: string): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(selector).forEach((n) => n.remove());
  return copy.textContent ?? "";
}

export function isPlace(tag: string, className: string | undefined, insideCardHeader: boolean): boolean {
  const classes = (className ?? "").split(/\s+/);
  if (tag === "h3" || tag === "h4") return !insideCardHeader;
  if (tag === "article") return true;
  return tag === "div" && classes.some((c) => c === "line" || c === "note" || c === "callout");
}

export function anchorOf(el: Element): string | null {
  return el.getAttribute("id") || el.getAttribute("data-id");
}

/** Short human-readable description of a place, stored with the task as its «where». */
export function placeLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = el.classList;
  const who = el.querySelector(".who");
  if (cls.contains("line")) {
    const speaker = clip(who ? textWithout(who, ".lid") : "Реплика", 40);
    const quote = el.querySelector("q")?.textContent ?? textWithout(el, ".who, .copy, .place-tools");
    return `${speaker}: «${clip(quote, 50)}»`;
  }
  if (cls.contains("note")) {
    const title = clip(who?.textContent || "Записка", 40);
    return `${title}: «${clip(textWithout(el, ".who, .place-tools"), 50)}»`;
  }
  if (cls.contains("callout")) {
    const heading = el.querySelector(".tag")?.textContent || "Заметка";
    return `Заметка «${clip(heading, 60)}»`;
  }
  if (tag === "article") {
    const title = el.querySelector("header h4, h4")?.textContent ?? textWithout(el, ".place-tools");
    return `Карточка «${clip(title, 60)}»`;
  }
  return `«${clip(textWithout(el, ".place-tools"))}»`;
}

/** All places in a section's HTML, in document order. */
export function placesIn(html: string): Place[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: Place[] = [];
  const seen = new Set<string>();
  doc.body.querySelectorAll("[id], [data-id]").forEach((el) => {
    const anchor = anchorOf(el);
    const insideCardHeader = Boolean(el.closest("article header"));
    if (!anchor || seen.has(anchor) || !isPlace(el.tagName.toLowerCase(), el.getAttribute("class") ?? "", insideCardHeader)) {
      return;
    }
    seen.add(anchor);
    let depth = 0;
    for (let p = el.parentElement?.closest("article"); p; p = p.parentElement?.closest("article")) depth++;
    out.push({ anchor, label: placeLabel(el), depth });
  });
  return out;
}

/** URL of a place on its page. */
export function placeHref(page: string | null, sectionSlug: string | null, anchor: string | null): string | null {
  if (!page || !sectionSlug) return null;
  const hash = anchor ?? (sectionSlug !== page ? sectionSlug : "");
  return `/s/${page}${hash ? `#${hash}` : ""}`;
}
