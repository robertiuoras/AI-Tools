import {
  LINKIFY_URL_REGEX,
  linkifyToHtmlString,
  trimUrlHref,
} from "./linkify-url";

/** Legacy bracket markers → ASCII markers (easier to type & regex). */
export function migrateLegacyNoteMarkup(text: string): string {
  return text
    .replace(/⟦c#([0-9a-fA-F]{3,8})⟧/g, "{{c#$1}}")
    .replace(/⟦\/c⟧/g, "{{/c}}")
    .replace(/⟦s(\d{1,3})⟧/g, "{{s$1}}")
    .replace(/⟦\/s⟧/g, "{{/s}}");
}

const BULLET_LINE_RE = /^(\s*)([-*•])\s+/;
const NUMBERED_LINE_RE = /^(\s*)\d+\.\s+/;

/** Inline DSL → HTML (after migrate). Nested color/size supported. */
const INLINE_DSL_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|==([^=\n]+)==|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\{\{c#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\}\}([\s\S]*?)\{\{\/c\}\}|\{\{s(\d{1,3})\}\}([\s\S]*?)\{\{\/s\}\}/g;

export function normalizeColorHex(h: string): string {
  if (h.length === 3) {
    return h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return h.slice(0, 6);
}

export function inlineDslToHtml(text: string, depth = 0): string {
  if (depth > 10) return linkifyToHtmlString(text);
  let out = "";
  let last = 0;
  const re = new RegExp(INLINE_DSL_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const i = m.index ?? 0;
    if (i > last) out += linkifyToHtmlString(text.slice(last, i));
    const [
      ,
      bold,
      italic,
      hi,
      u,
      strike,
      code,
      colorHex,
      colorInner,
      sizePx,
      sizeInner,
    ] = m;
    if (typeof bold === "string") {
      out += `<strong>${inlineDslToHtml(bold, depth + 1)}</strong>`;
    } else if (typeof italic === "string") {
      out += `<em>${inlineDslToHtml(italic, depth + 1)}</em>`;
    } else if (typeof hi === "string") {
      out += `<mark class="note-highlight">${inlineDslToHtml(hi, depth + 1)}</mark>`;
    } else if (typeof u === "string") {
      out += `<u>${linkifyToHtmlString(u)}</u>`;
    } else if (typeof strike === "string") {
      out += `<s>${linkifyToHtmlString(strike)}</s>`;
    } else if (typeof code === "string") {
      out += `<code class="rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono">${escapeHtml(code)}</code>`;
    } else if (typeof colorHex === "string" && colorInner !== undefined) {
      const hex = normalizeColorHex(colorHex);
      out += `<span style="color:#${hex}">${inlineDslToHtml(colorInner, depth + 1)}</span>`;
    } else if (typeof sizePx === "string" && sizeInner !== undefined) {
      const px = Math.min(72, Math.max(8, parseInt(sizePx, 10) || 16));
      out += `<span style="font-size:${px}px !important">${inlineDslToHtml(sizeInner, depth + 1)}</span>`;
    }
    last = i + m[0].length;
  }
  if (last < text.length) out += linkifyToHtmlString(text.slice(last));
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Full note DSL (markdown-like + {{c#}}{{s}}) → HTML fragment. */
export function dslToHtml(markup: string): string {
  const migrated = migrateLegacyNoteMarkup(markup);
  const lines = migrated.split(/\r?\n/);
  const parts: string[] = [];
  const ul: string[] = [];
  const ol: string[] = [];

  const flushUl = () => {
    if (ul.length) {
      parts.push(
        `<ul>${ul.map((li) => `<li>${inlineDslToHtml(li)}</li>`).join("")}</ul>`,
      );
      ul.length = 0;
    }
  };
  const flushOl = () => {
    if (ol.length) {
      parts.push(
        `<ol>${ol.map((li) => `<li>${inlineDslToHtml(li)}</li>`).join("")}</ol>`,
      );
      ol.length = 0;
    }
  };
  const flushLists = () => {
    flushUl();
    flushOl();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (NUMBERED_LINE_RE.test(line)) {
      flushUl();
      ol.push(line.replace(NUMBERED_LINE_RE, ""));
      continue;
    }
    if (BULLET_LINE_RE.test(line)) {
      flushOl();
      ul.push(line.replace(BULLET_LINE_RE, ""));
      continue;
    }
    flushLists();
    if (line.trim() === "") {
      parts.push("<p><br></p>");
      continue;
    }
    const hm = line.match(/^##\s+(.*)$/);
    if (hm) {
      parts.push(
        `<h3 class="scroll-m-20 text-lg font-semibold tracking-tight">${inlineDslToHtml(hm[1] ?? "")}</h3>`,
      );
      continue;
    }
    parts.push(`<p>${inlineDslToHtml(line)}</p>`);
  }
  flushLists();
  return parts.join("");
}

/** Heuristic: stored note body is sanitized HTML vs legacy plain/DSL. */
export function isProbablyHtml(content: string): boolean {
  const t = content.trim();
  if (t.length < 3) return false;
  if (!t.startsWith("<")) return false;
  return /<\/?[a-z][\s\S]*>/i.test(t);
}

const ALLOWED_TAGS = new Set([
  "P",
  "DIV",
  "BR",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "MARK",
  "CODE",
  "SPAN",
  "A",
  "FONT", // some browsers emit <font color> for foreColor
]);

function sanitizeStyleValue(style: string): string | null {
  const chunks = style
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const chunk of chunks) {
    if (
      /^color:\s*#?[0-9a-fA-F]{3,8}$/i.test(chunk) ||
      /^color:\s*rgba?\([^)]+\)$/i.test(chunk)
    ) {
      kept.push(chunk);
      continue;
    }
    if (/^background-color:\s*#?[0-9a-fA-F]{3,8}$/i.test(chunk)) {
      kept.push(chunk);
      continue;
    }
    if (
      /^font-size:\s*\d+(?:\.\d+)?(?:px|pt|rem|em)(?:\s*!important)?$/i.test(
        chunk,
      )
    ) {
      kept.push(chunk);
    }
  }
  return kept.length ? kept.join("; ") : null;
}

function sanitizeElement(el: Element): void {
  const tag = el.tagName.toUpperCase();
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME") {
    el.remove();
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    return;
  }

  const attrs = [...el.attributes];
  for (const a of attrs) {
    const name = a.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(a.name);
      continue;
    }
    if (name === "href" && tag === "A") {
      const v = a.value.trim();
      if (!/^https?:\/\//i.test(v)) el.removeAttribute(a.name);
      continue;
    }
    if (name === "style" && (tag === "SPAN" || tag === "FONT" || tag === "MARK")) {
      const cleaned = sanitizeStyleValue(el.getAttribute("style") || "");
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
      continue;
    }
    if (tag === "FONT" && name === "color") {
      const c = a.value.trim();
      if (/^#?[0-9a-fA-F]{3,8}$/i.test(c)) continue;
      el.removeAttribute(a.name);
      continue;
    }
    if (name === "class" && (tag === "CODE" || tag === "MARK" || tag === "H3")) {
      continue;
    }
    if (name === "target" && tag === "A" && a.value === "_blank") continue;
    if (name === "rel" && tag === "A") continue;
    el.removeAttribute(a.name);
  }

  if (tag === "A") {
    const href = el.getAttribute("href")?.trim();
    if (href && /^https?:\/\//i.test(href)) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  }

  const children = [...el.children];
  for (const child of children) sanitizeElement(child);
}

/** Strip unsafe tags/attributes from note HTML (client-safe for dangerouslySetInnerHTML). */
export function sanitizeNoteHtml(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=/gi, " data-stripped=");
  }
  const doc = new DOMParser().parseFromString(
    `<div id="note-root">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById("note-root");
  if (!root) return "";
  const children = [...root.children];
  for (const c of children) sanitizeElement(c);
  return root.innerHTML;
}

/**
 * Consecutive <p> blocks immediately followed by <ul>/<ol> where each <li> matches each <p>
 * (browser often leaves the old paragraphs when turning a block into a list).
 */
function removeDuplicateParagraphsBeforeMatchingList(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  const norm = (t: string) =>
    t.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  let i = 0;
  while (i < root.children.length) {
    let j = i;
    const ps: Element[] = [];
    while (j < root.children.length && root.children[j]!.tagName === "P") {
      ps.push(root.children[j]!);
      j++;
    }
    if (ps.length === 0) {
      i++;
      continue;
    }
    if (j >= root.children.length) break;
    const list = root.children[j];
    if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) {
      i++;
      continue;
    }
    const lis = [...list.children].filter((c) => c.tagName === "LI");
    if (lis.length !== ps.length || lis.length === 0) {
      i++;
      continue;
    }
    let match = true;
    for (let k = 0; k < ps.length; k++) {
      if (norm(ps[k]!.textContent ?? "") !== norm(lis[k]!.textContent ?? "")) {
        match = false;
        break;
      }
    }
    if (match) {
      for (const p of ps) p.remove();
      continue;
    }
    i++;
  }
  return root.innerHTML;
}

/** Collapse common contenteditable bug: extra <p> after list duplicating last item text. */
function removeDuplicateParagraphAfterList(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  const norm = (t: string) =>
    t.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  let i = 0;
  while (i < root.children.length - 1) {
    const a = root.children[i];
    const b = root.children[i + 1];
    if (!a || !b) {
      i++;
      continue;
    }
    if (a.tagName !== "UL" && a.tagName !== "OL") {
      i++;
      continue;
    }
    if (b.tagName !== "P") {
      i++;
      continue;
    }
    const lastLi = a.lastElementChild;
    if (!lastLi || lastLi.tagName !== "LI") {
      i++;
      continue;
    }
    const liText = norm(lastLi.textContent ?? "");
    const pText = norm(b.textContent ?? "");
    if (liText.length > 0 && liText === pText) {
      b.remove();
      continue;
    }
    i++;
  }
  return root.innerHTML;
}

/**
 * Wrap plain https? URLs in text nodes with <a> (skips existing links and code blocks).
 */
function linkifyPlainUrlsInHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const doc = new DOMParser().parseFromString(
    `<div id="note-linkify-root">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById("note-linkify-root");
  if (!root) return html;

  const skipIfInside = new Set(["A", "CODE", "PRE", "SCRIPT", "STYLE"]);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el: Element | null = node.parentElement;
      while (el) {
        if (skipIfInside.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const batch: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    batch.push(n as Text);
  }

  for (const textNode of batch) {
    if (!textNode.parentNode) continue;
    const text = textNode.textContent ?? "";
    if (!text) continue;
    const re = new RegExp(LINKIFY_URL_REGEX.source, "gi");
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      const idx = m.index ?? 0;
      if (idx > last) {
        frag.appendChild(doc.createTextNode(text.slice(last, idx)));
      }
      const raw = m[0];
      const href = trimUrlHref(raw);
      if (href.length > 0) {
        const a = doc.createElement("a");
        a.setAttribute("href", href);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        a.appendChild(doc.createTextNode(raw));
        frag.appendChild(a);
      } else {
        frag.appendChild(doc.createTextNode(raw));
      }
      last = idx + raw.length;
    }
    if (last < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(last)));
    }
    parent.replaceChild(frag, textNode);
  }

  return root.innerHTML;
}

/** Sanitize + remove duplicate paragraph/list patterns (safe for read view and editor load). */
export function normalizeNoteHtmlStructure(html: string): string {
  let s = sanitizeNoteHtml(html);
  if (typeof document !== "undefined") {
    s = linkifyPlainUrlsInHtml(s);
    s = sanitizeNoteHtml(s);
    s = removeDuplicateParagraphsBeforeMatchingList(s);
    s = removeDuplicateParagraphAfterList(s);
  }
  return s;
}

/** Editor / read view: legacy DSL → HTML, or pass-through sanitized HTML. */
export function noteContentToEditorHtml(content: string): string {
  const t = content.trim();
  if (!t) return "<p><br></p>";
  if (isProbablyHtml(content)) return normalizeNoteHtmlStructure(content);
  return sanitizeNoteHtml(dslToHtml(content));
}

/** Before persist: normalize empty-ish editor output. */
export function normalizeNoteHtmlForSave(html: string): string {
  let s = normalizeNoteHtmlStructure(html);
  const tmp =
    typeof document !== "undefined"
      ? new DOMParser().parseFromString(`<div>${s}</div>`, "text/html").body
          .textContent ?? ""
      : s.replace(/<[^>]+>/g, "");
  if (!tmp.replace(/\u00a0/g, " ").trim()) return "";
  return s;
}

/** Plain text for clipboard (strip tags). */
export function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.innerText || "";
}
