import { NextRequest, NextResponse } from "next/server";
import { fetchDiscordNews, getDiscordNewsConfig } from "@/lib/discord-news";

export const dynamic = "force-dynamic";

/**
 * GET /api/news
 *
 * Returns the latest messages from the configured Discord channel
 * (DISCORD_NEWS_CHANNEL_ID) so the /news page can render them as a
 * news feed. Server-side cached (default 60s) so we never hit Discord
 * rate limits even with many tabs polling.
 *
 * Query params:
 *   ?force=1   — bypass the cache (dev only; returns fresh data)
 */
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const cfg = getDiscordNewsConfig();

  if (!cfg.configured) {
    return NextResponse.json(
      {
        configured: false,
        items: [],
        channelName: null,
        fetchedAt: Date.now(),
        cached: false,
        setupHint:
          "Set DISCORD_BOT_TOKEN and DISCORD_NEWS_CHANNEL_ID in your environment, then reload.",
      },
      { status: 200 },
    );
  }

  const result = await fetchDiscordNews({ force });
  return NextResponse.json(
    {
      configured: true,
      items: result.items,
      channelName: result.channelName ?? null,
      fetchedAt: result.fetchedAt,
      cached: result.cached,
      ...(result.error ? { error: result.error } : {}),
    },
    {
      status: result.ok ? 200 : 502,
      headers: {
        // Tell browsers/CDNs not to keep their own copy beyond our
        // server cache TTL; we already deduplicate at the source.
        "Cache-Control": `public, max-age=0, s-maxage=${Math.max(15, Math.floor(cfg.cacheMs / 1000) - 5)}, stale-while-revalidate=60`,
      },
    },
  );
}
