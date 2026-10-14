/** Images in scenario Markdown: ![alt](url "caption"). */
export interface MarkdownImage {
  /** Position of the whole `![…](…)` in the source. */
  start: number;
  end: number;
  alt: string;
  url: string;
  caption: string;
  /** Where the URL itself sits in the source, so it can be swapped without touching alt and caption. */
  urlStart: number;
  urlEnd: number;
}

const IMAGE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+"([^"\n]*)")?\s*\)/g;

export function findImages(source: string): MarkdownImage[] {
  const found: MarkdownImage[] = [];
  for (const m of source.matchAll(IMAGE)) {
    const start = m.index ?? 0;
    const rawUrl = m[2];
    const urlStart = start + m[0].indexOf(rawUrl, 2 + m[1].length);
    found.push({
      start,
      end: start + m[0].length,
      alt: m[1],
      url: rawUrl.replace(/^<|>$/g, ""),
      caption: m[3] ?? "",
      urlStart,
      urlEnd: urlStart + rawUrl.length,
    });
  }
  return found;
}

/**
 * Point the `index`-th image at `newUrl`. The text may have changed while the file was uploading, so the image is
 * looked up again: the same position in the list with the same old URL, or else the first image with that URL.
 * Returns null when the image is gone.
 */
export function replaceImage(source: string, index: number, oldUrl: string, newUrl: string): string | null {
  const images = findImages(source);
  const target = images[index]?.url === oldUrl ? images[index] : images.find((i) => i.url === oldUrl);
  if (!target) return null;
  return source.slice(0, target.urlStart) + newUrl + source.slice(target.urlEnd);
}
