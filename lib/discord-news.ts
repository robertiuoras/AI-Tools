/**
 * Polls a Discord channel and turns each message into a news item the
 * /news page can render. Uses a tiny in-memory cache so we never hit
 * Discord's 50-req/sec global rate limit even if many tabs hammer the
 * /api/news endpoint at once.
 *
 * Setup (one-time):
 *   1. Create a Discord application at https://discord.com/developers
 *   2. Add a Bot user. Copy the bot token.
 *   3. Invite the bot to your server with the "Read Messages" + "View
 *      Channel" permissions and the `bot` scope.
 *   4. In Discord: enable Developer Mode (User Settings → Advanced),
 *      then right-click your news channel → Copy Channel ID.
 *   5. Add to .env / Vercel project env:
 *
 *        DISCORD_BOT_TOKEN=...
 *        DISCORD_NEWS_CHANNEL_ID=123456789012345678
 *
 *   6. (Optional) DISCORD_NEWS_LIMIT=30   # how many recent messages to pull
 *      (Optional) DISCORD_NEWS_CACHE_MS=60000  # server-side cache TTL
 */

const API_BASE = "https://discord.com/api/v10";

export interface NewsAttachment {
  id: string;
  url: string;
  proxyUrl?: string;
  filename: string;
  contentType?: string;
  width?: number;
  height?: number;
  isImage: boolean;
}

export interface NewsEmbed {
  title?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  color?: number;
  authorName?: string;
  authorUrl?: string;
  authorIconUrl?: string;
  providerName?: string;
}

export interface NewsAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface NewsItem {
  id: string;
  channelId: string;
  authorName: string;
  author: NewsAuthor;
  /** Plain markdown content as posted in Discord. */
  content: string;
  /** ISO timestamp (createdAt). */
  timestamp: string;
  editedTimestamp?: string;
  attachments: NewsAttachment[];
  embeds: NewsEmbed[];
  /** Convenience: any link found in the content (first match). */
  primaryLink?: string;
  /** Convenience: total reaction count. */
  reactionCount: number;
}

export interface DiscordNewsConfig {
  configured: boolean;
  channelId: string | null;
  limit: number;
  cacheMs: number;
}

export function getDiscordNewsConfig(): DiscordNewsConfig {
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const channelId = (process.env.DISCORD_NEWS_CHANNEL_ID ?? "").trim();
  const limit = clamp(parseInt(process.env.DISCORD_NEWS_LIMIT ?? "30", 10), 1, 100);
  const cacheMs = clamp(
    parseInt(process.env.DISCORD_NEWS_CACHE_MS ?? "60000", 10),
    5_000,
    10 * 60_000,
  );
  return {
    configured: token.length > 0 && channelId.length > 0,
    channelId: channelId || null,
    limit,
    cacheMs,
  };
}

interface CacheEntry {
  fetchedAt: number;
  items: NewsItem[];
  channelName?: string | null;
}

// Module-level cache (lives for the lifetime of the serverless instance).
const cache = new Map<string, CacheEntry>();

interface FetchResult {
  ok: boolean;
  items: NewsItem[];
  channelName?: string | null;
  fetchedAt: number;
  cached: boolean;
  error?: string;
}

/**
 * Fetches recent messages from the configured Discord channel.
 * Returns cached results if the cache is fresh.
 */
export async function fetchDiscordNews(opts: { force?: boolean } = {}): Promise<FetchResult> {
  const cfg = getDiscordNewsConfig();
  if (!cfg.configured || !cfg.channelId) {
    return {
      ok: false,
      items: [],
      fetchedAt: Date.now(),
      cached: false,
      error: "discord_not_configured",
    };
  }

  const cacheKey = `${cfg.channelId}:${cfg.limit}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (!opts.force && cached && now - cached.fetchedAt < cfg.cacheMs) {
    return {
      ok: true,
      items: cached.items,
      channelName: cached.channelName,
      fetchedAt: cached.fetchedAt,
      cached: true,
    };
  }

  const token = process.env.DISCORD_BOT_TOKEN!.trim();
  try {
    // Pull messages and channel metadata in parallel so we can show a
    // "from #ai-news" badge without a second round-trip.
    const [messagesRes, channelRes] = await Promise.all([
      fetch(
        `${API_BASE}/channels/${cfg.channelId}/messages?limit=${cfg.limit}`,
        {
          headers: {
            Authorization: `Bot ${token}`,
            "User-Agent": "AI-Tools-NewsBot (https://example.com, 1.0)",
          },
          // Force a network fetch — we manage caching ourselves.
          cache: "no-store",
        },
      ),
      fetch(`${API_BASE}/channels/${cfg.channelId}`, {
        headers: {
          Authorization: `Bot ${token}`,
          "User-Agent": "AI-Tools-NewsBot (https://example.com, 1.0)",
        },
        cache: "no-store",
      }),
    ]);

    if (!messagesRes.ok) {
      const text = await messagesRes.text().catch(() => "");
      const err = `discord_${messagesRes.status}: ${text.slice(0, 200)}`;
      // Serve stale cache if we have anything, rather than a hard fail.
      if (cached) {
        return {
          ok: true,
          items: cached.items,
          channelName: cached.channelName,
          fetchedAt: cached.fetchedAt,
          cached: true,
          error: err,
        };
      }
      return {
        ok: false,
        items: [],
        fetchedAt: now,
        cached: false,
        error: err,
      };
    }

    const raw = (await messagesRes.json()) as DiscordRawMessage[];
    const channelJson = channelRes.ok
      ? ((await channelRes.json()) as { name?: string | null })
      : null;
    const channelName = channelJson?.name ?? null;

    const items = raw
      .filter((m) => !m.flags || (m.flags & 1) === 0) // skip CROSSPOSTED-only-by-other-channel noise
      .map((m) => normalizeMessage(m, cfg.channelId!));

    const entry: CacheEntry = { fetchedAt: now, items, channelName };
    cache.set(cacheKey, entry);

    return {
      ok: true,
      items,
      channelName,
      fetchedAt: now,
      cached: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cached) {
      return {
        ok: true,
        items: cached.items,
        channelName: cached.channelName,
        fetchedAt: cached.fetchedAt,
        cached: true,
        error: msg,
      };
    }
    return {
      ok: false,
      items: [],
      fetchedAt: now,
      cached: false,
      error: msg,
    };
  }
}

// ---------- Discord payload normalization ----------

interface DiscordRawAttachment {
  id: string;
  url: string;
  proxy_url?: string;
  filename: string;
  content_type?: string;
  width?: number;
  height?: number;
}

interface DiscordRawEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  image?: { url?: string; proxy_url?: string };
  thumbnail?: { url?: string; proxy_url?: string };
  author?: { name?: string; url?: string; icon_url?: string };
  provider?: { name?: string };
}

interface DiscordRawReaction {
  count: number;
}

interface DiscordRawAuthor {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
}

interface DiscordRawMessage {
  id: string;
  channel_id: string;
  author: DiscordRawAuthor;
  member?: { nick?: string | null };
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  flags?: number;
  attachments?: DiscordRawAttachment[];
  embeds?: DiscordRawEmbed[];
  reactions?: DiscordRawReaction[];
}

function normalizeMessage(m: DiscordRawMessage, channelId: string): NewsItem {
  const attachments: NewsAttachment[] = (m.attachments ?? []).map((a) => ({
    id: a.id,
    url: a.url,
    proxyUrl: a.proxy_url,
    filename: a.filename,
    contentType: a.content_type,
    width: a.width,
    height: a.height,
    isImage:
      (a.content_type ?? "").startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(a.filename ?? ""),
  }));

  const embeds: NewsEmbed[] = (m.embeds ?? []).map((e) => ({
    title: e.title,
    description: e.description,
    url: e.url,
    imageUrl: e.image?.url ?? e.image?.proxy_url,
    thumbnailUrl: e.thumbnail?.url ?? e.thumbnail?.proxy_url,
    color: e.color,
    authorName: e.author?.name,
    authorUrl: e.author?.url,
    authorIconUrl: e.author?.icon_url,
    providerName: e.provider?.name,
  }));

  const reactionCount =
    (m.reactions ?? []).reduce((acc, r) => acc + (r.count ?? 0), 0) || 0;

  const linkMatch = m.content.match(/https?:\/\/[^\s<>"]+/);
  const primaryLink =
    linkMatch?.[0] ?? embeds.find((e) => e.url)?.url ?? attachments[0]?.url;

  const author: NewsAuthor = {
    id: m.author.id,
    username: m.author.username,
    displayName:
      m.member?.nick ||
      m.author.global_name ||
      m.author.username ||
      "Unknown",
    avatarUrl: m.author.avatar
      ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=128`
      : defaultAvatarFor(m.author),
  };

  return {
    id: m.id,
    channelId,
    authorName: author.displayName,
    author,
    content: m.content ?? "",
    timestamp: m.timestamp,
    editedTimestamp: m.edited_timestamp ?? undefined,
    attachments,
    embeds,
    primaryLink,
    reactionCount,
  };
}

function defaultAvatarFor(a: DiscordRawAuthor): string {
  // Discord's "default" avatar derived from the user id (post-2023 system).
  // Fallback to discriminator-based for legacy accounts.
  let idx = 0;
  try {
    // Discord post-2023 default avatar derivation: (snowflake >> 22) % 6.
    // BigInt() avoids precision loss; constructor form keeps tsc target
    // flexible (no BigInt literal syntax required).
    const six = BigInt(6);
    const shift = BigInt(22);
    idx = Number((BigInt(a.id) >> shift) % six);
  } catch {
    idx = (parseInt(a.discriminator ?? "0", 10) || 0) % 5;
  }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
