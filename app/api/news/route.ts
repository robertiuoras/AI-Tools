import { google } from "googleapis";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image?: string;
  siteName?: string;
}

interface NewsRow {
  content: string;
  timestamp: string;
  links: LinkPreview[];
}

const LINK_PREVIEW_CACHE_MS = 10 * 60 * 1000;
const linkPreviewCache = new Map<string, { expiresAt: number; data: LinkPreview }>();

export async function GET() {
  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!clientEmail || !privateKey || !sheetId) {
      return NextResponse.json(
        { error: "Google Sheets environment variables are missing." },
        { status: 500 },
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!A:C",
    });

    const rows = response.data.values ?? [];
    const baseItems = rows
      .filter((row) => row.length > 0 && String(row[0] ?? "").trim() !== "")
      .map((row) => ({
        content: String(row[0] ?? "").trim(),
        // Column C is the timestamp field; fall back to B when needed.
        timestamp: String(row[2] ?? row[1] ?? "").trim(),
      }));

    const mergedItems = mergeContinuationRows(baseItems);

    const items: NewsRow[] = (
      await Promise.all(
        mergedItems.reverse().map(async (item) => {
          const cleaned = normalizeNewsItem(item.content, item.timestamp);
          const urls = extractUrls(cleaned.content).slice(0, 3);
          const links = await Promise.all(urls.map((url) => getLinkPreview(url)));
          return {
            content: cleaned.content,
            timestamp: cleaned.timestamp,
            links: links.filter((link): link is LinkPreview => link !== null),
          };
        }),
      )
    ).filter((item) => item.content.trim().length > 0);

    return NextResponse.json(dedupeStoryVariants(items));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load Google Sheet news: ${message}` },
      { status: 500 },
    );
  }
}

function dedupeStoryVariants(items: NewsRow[]): NewsRow[] {
  const seen = new Set<string>();
  const deduped: NewsRow[] = [];

  // `items` are newest-first; keep the first (latest) variant we see.
  for (const item of items) {
    const key = canonicalStoryKey(item.content);
    if (!key) {
      deduped.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function canonicalStoryKey(content: string): string {
  const normalized = content
    // Keep link text, drop URL target for markdown links.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    // Drop bare URLs so reposts with different sources still dedupe.
    .replace(/https?:\/\/[^\s<>"'`]+/g, "")
    .replace(/[*_`>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) return "";
  return normalized;
}

function mergeContinuationRows(
  rows: Array<{ content: string; timestamp: string }>,
): Array<{ content: string; timestamp: string }> {
  const merged: Array<{ content: string; timestamp: string }> = [];
  let pendingDateHeader: string | null = null;

  for (const row of rows) {
    const content = row.content.trim();
    if (!content) continue;

    if (isDateOnlyLine(content)) {
      pendingDateHeader = content;
      continue;
    }

    const previous = merged[merged.length - 1];
    if (previous && isLikelyContinuation(content, previous.content, row.timestamp, previous.timestamp)) {
      previous.content = `${previous.content}\n\n${content}`.trim();
      if (!previous.timestamp && row.timestamp) previous.timestamp = row.timestamp;
      continue;
    }

    const withPendingDate = pendingDateHeader
      ? `${pendingDateHeader}\n\n${content}`.trim()
      : content;
    pendingDateHeader = null;
    merged.push({ ...row, content: withPendingDate });
  }

  return merged;
}

function isDateOnlyLine(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) return false;
  return parseDateLikeLine(lines[0]) !== null;
}

function isLikelyContinuation(
  currentContent: string,
  previousContent: string,
  currentTimestamp: string,
  previousTimestamp: string,
): boolean {
  if (!currentContent || !previousContent) return false;

  const firstLine = currentContent.split(/\r?\n/)[0]?.trim() ?? "";
  const startsLikeStandalone =
    parseDateLikeLine(firstLine) !== null ||
    /^[A-Z][\w'"(]/.test(firstLine) ||
    /^#{1,6}\s+/.test(firstLine);

  const isUrlOnly = /^https?:\/\/\S+$/i.test(firstLine) && currentContent.trim() === firstLine;
  const startsLikeContinuation =
    isUrlOnly ||
    /^[a-z0-9(]/.test(firstLine) ||
    /^[0-9][0-9,.\-+]/.test(firstLine) ||
    /^[:;,\-]/.test(firstLine);

  if (!startsLikeContinuation || startsLikeStandalone) return false;

  if (!currentTimestamp) return true;
  if (!previousTimestamp) return true;

  const currentDate = new Date(currentTimestamp);
  const previousDate = new Date(previousTimestamp);
  if (Number.isNaN(currentDate.getTime()) || Number.isNaN(previousDate.getTime())) return false;

  return (
    currentDate.getUTCFullYear() === previousDate.getUTCFullYear() &&
    currentDate.getUTCMonth() === previousDate.getUTCMonth() &&
    currentDate.getUTCDate() === previousDate.getUTCDate()
  );
}

/** Discord role/user mentions — strip from published news. */
function stripDiscordMentions(text: string): string {
  return text.replace(/<@&\d+>/g, "").replace(/<@!?\d+>/g, "");
}

/** Remove leading # / ## markdown heading markers per line. */
function stripMarkdownHeadingHashes(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const lead = line.length - line.trimStart().length;
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("#")) return line;
      const rest = trimmed.replace(/^#{1,6}\s*/, "");
      return line.slice(0, lead) + rest;
    })
    .join("\n");
}

function preprocessNewsRawContent(raw: string): string {
  let t = stripDiscordMentions(raw);
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function normalizeNewsItem(
  rawContent: string,
  rawTimestamp: string,
): { content: string; timestamp: string } {
  const preprocessed = preprocessNewsRawContent(rawContent);
  const originalLines = preprocessed.split(/\r?\n/);
  const firstOriginalContentLine =
    originalLines.find((line) => line.trim().length > 0) ?? "";
  const inferredFromOriginalFirstLine = parseDateLikeLine(firstOriginalContentLine);
  const withoutLeadingDate = stripLeadingDateHeader(preprocessed);
  const lines = withoutLeadingDate.split(/\r?\n/);
  const firstContentLineAfterStrip = lines.find((line) => line.trim().length > 0) ?? "";
  const inferredFromLineAfterStrip = parseDateLikeLine(firstContentLineAfterStrip);

  return {
    // Keep sheet content as-is (except Discord mentions) to avoid dropping
    // paragraphs when entries span irregular row formats.
    content: withoutLeadingDate.trim(),
    // Prefer explicit date headers from the news content (e.g. "May 3rd")
    // over sheet timestamp columns, which may drift by timezone.
    timestamp:
      inferredFromOriginalFirstLine?.toISOString() ??
      inferredFromLineAfterStrip?.toISOString() ??
      rawTimestamp,
  };
}

function stripLeadingDateHeader(content: string): string {
  const lines = content.split(/\r?\n/);
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIdx < 0) return content;
  if (parseDateLikeLine(lines[firstNonEmptyIdx]) === null) return content;

  const remaining = lines.slice(firstNonEmptyIdx + 1).join("\n").trim();
  if (!remaining) return content;
  return remaining;
}

function parseDateLikeLine(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const markdownUnwrapped = trimmed
    .replace(/^[*_`~#>\s]+/, "")
    .replace(/[*_`~\s]+$/, "");

  const cleaned = markdownUnwrapped
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    .replace(/[,:;.!?]+$/, "");

  if (/^yesterday$/i.test(cleaned)) {
    const now = new Date();
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  if (/^today$/i.test(cleaned)) {
    const now = new Date();
    return now;
  }

  const dateLikePattern =
    /^(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?(?:(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s+\d{4})?)(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?:\s?[ap]m)?)?$/i;

  if (!dateLikePattern.test(cleaned)) return null;

  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) return direct;

  const now = new Date();
  const withYear = new Date(`${cleaned} ${now.getFullYear()}`);
  if (!Number.isNaN(withYear.getTime())) return withYear;

  return null;
}

function extractUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s<>"'`]+/g) ?? [];
  const cleaned = matches.map((url) => url.replace(/[),.;!?]+$/, ""));
  return Array.from(new Set(cleaned));
}

async function getLinkPreview(url: string): Promise<LinkPreview | null> {
  const cached = linkPreviewCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      const fallback = {
        url,
        title: url,
        description: "",
        siteName: safeHostname(url),
      };
      linkPreviewCache.set(url, {
        expiresAt: Date.now() + LINK_PREVIEW_CACHE_MS,
        data: fallback,
      });
      return fallback;
    }

    const html = await res.text();
    const title =
      extractMetaTag(html, "property", "og:title") ??
      extractMetaTag(html, "name", "twitter:title") ??
      extractTitle(html) ??
      url;
    const description =
      extractMetaTag(html, "property", "og:description") ??
      extractMetaTag(html, "name", "description") ??
      extractMetaTag(html, "name", "twitter:description") ??
      "";
    const image =
      extractMetaTag(html, "property", "og:image") ??
      extractMetaTag(html, "name", "twitter:image");
    const siteName =
      extractMetaTag(html, "property", "og:site_name") ??
      extractMetaTag(html, "name", "application-name") ??
      safeHostname(url);

    const data: LinkPreview = {
      url,
      title: cleanText(title),
      description: cleanText(description),
      image: image ? absolutizeUrl(url, image) : undefined,
      siteName: cleanText(siteName),
    };

    linkPreviewCache.set(url, {
      expiresAt: Date.now() + LINK_PREVIEW_CACHE_MS,
      data,
    });
    return data;
  } catch {
    return null;
  }
}

function extractMetaTag(html: string, attr: "property" | "name", key: string): string | null {
  const regex = new RegExp(
    `<meta[^>]*${attr}=["']${escapeRegex(key)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const reverseRegex = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escapeRegex(key)}["'][^>]*>`,
    "i",
  );
  const match = html.match(regex) ?? html.match(reverseRegex);
  return match?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ?? null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function absolutizeUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
