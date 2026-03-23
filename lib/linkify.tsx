import React from "react";
import { LINKIFY_URL_REGEX, trimUrlHref } from "./linkify-url";

/**
 * Renders plain text with http(s) URLs as external links.
 * Preserves line breaks via parent `whitespace-pre-wrap`.
 */
export function linkifyText(text: string): React.ReactNode {
  if (!text) return null;

  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(LINKIFY_URL_REGEX)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    const href = trimUrlHref(raw);
    if (href.length > 0) {
      nodes.push(
        <a
          key={`l-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 break-all"
        >
          {raw}
        </a>,
      );
    } else {
      nodes.push(raw);
    }
    last = start + raw.length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return <>{nodes}</>;
}
