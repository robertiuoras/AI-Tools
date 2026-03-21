/** Match http(s) URLs in plain text (stops at common delimiters). */
export const LINKIFY_URL_REGEX = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** Strip trailing punctuation that often wraps URLs in prose. */
export function trimUrlHref(raw: string): string {
  return raw.replace(/[.,;:!?)'"\]]+$/u, "");
}

/** Escape HTML entities in plain text. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text → HTML with clickable https links (for note DSL → HTML). */
export function linkifyToHtmlString(text: string): string {
  if (!text) return "";
  const re = new RegExp(LINKIFY_URL_REGEX.source, "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const i = m.index ?? 0;
    if (i > last) {
      out += escapeHtml(text.slice(last, i));
    }
    const raw = m[0];
    const href = trimUrlHref(raw);
    if (href.length > 0) {
      out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="font-medium text-primary underline underline-offset-2 break-all">${escapeHtml(raw)}</a>`;
    } else {
      out += escapeHtml(raw);
    }
    last = i + raw.length;
  }
  if (last < text.length) {
    out += escapeHtml(text.slice(last));
  }
  return out;
}
