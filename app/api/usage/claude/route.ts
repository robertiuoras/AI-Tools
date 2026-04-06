import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 400 })
  }

  try {
    // Verify the key is valid by listing models
    const modelsRes = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      cache: 'no-store',
    })

    if (!modelsRes.ok) {
      const err = await modelsRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: err?.error?.message ?? `Anthropic API error ${modelsRes.status}` },
        { status: modelsRes.status },
      )
    }

    const modelsData = await modelsRes.json()
    const models: { id: string; display_name?: string; created_at?: string }[] =
      modelsData.data ?? []

    return NextResponse.json({
      connected: true,
      models: models.map((m) => ({
        id: m.id,
        name: m.display_name ?? m.id,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
