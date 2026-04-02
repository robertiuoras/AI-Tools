/**
 * Find text within a root element (read or contenteditable), case-insensitive.
 * Returns whether a match was selected and scrolled into view.
 */
export function findTextInRoot(
  root: HTMLElement | null,
  query: string,
  forward: boolean,
): boolean {
  const q = query.trim();
  if (!q || !root) return false;

  const qLower = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: { node: Text; start: number }[] = [];
  let full = "";
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    const el = n.parentElement;
    if (!el) continue;
    if (el.closest("script,style")) continue;
    chunks.push({ node: n, start: full.length });
    full += n.textContent ?? "";
  }

  if (!full) return false;
  const lower = full.toLowerCase();

  const sel = window.getSelection();
  let cursor = 0;
  if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
    cursor = offsetInFlattenedText(root, sel.anchorNode, sel.anchorOffset);
  }

  const matches: number[] = [];
  let from = 0;
  while (from <= lower.length) {
    const i = lower.indexOf(qLower, from);
    if (i < 0) break;
    matches.push(i);
    from = i + 1;
  }
  if (matches.length === 0) return false;

  let pick: number;
  if (forward) {
    pick = matches.find((m) => m > cursor) ?? matches[0]!;
  } else {
    const rev = [...matches].reverse();
    pick = rev.find((m) => m < cursor) ?? rev[0]!;
  }

  const end = pick + q.length;
  const range = document.createRange();
  if (!setRangeToTextOffsets(range, chunks, pick, end)) return false;
  sel?.removeAllRanges();
  sel?.addRange(range);
  const el =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer.parentElement ?? undefined)
      : (range.startContainer as Element);
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function offsetInFlattenedText(
  root: HTMLElement,
  node: Node | null,
  offset: number,
): number {
  if (!node) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let t: Text | null;
  while ((t = walker.nextNode() as Text | null)) {
    const el = t.parentElement;
    if (!el || el.closest("script,style")) continue;
    if (t === node) return acc + offset;
    acc += t.textContent?.length ?? 0;
  }
  return 0;
}

function setRangeToTextOffsets(
  range: Range,
  chunks: { node: Text; start: number }[],
  start: number,
  end: number,
): boolean {
  if (start < 0 || start >= end) return false;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  for (const { node, start: base } of chunks) {
    const len = node.textContent?.length ?? 0;
    const nodeEnd = base + len;
    if (startNode === null && start < nodeEnd) {
      startNode = node;
      startOff = Math.max(0, start - base);
    }
    if (end <= nodeEnd && end > base) {
      endNode = node;
      endOff = Math.max(0, end - base);
      break;
    }
  }
  if (!startNode || !endNode) return false;
  range.setStart(
    startNode,
    Math.min(startOff, startNode.textContent?.length ?? 0),
  );
  range.setEnd(endNode, Math.min(endOff, endNode.textContent?.length ?? 0));
  return true;
}
