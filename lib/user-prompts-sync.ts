import {
  normalizeUserPromptsPayload,
  type UserPrompt,
} from "@/lib/prompt-data";

export async function fetchUserPromptsFromAccount(
  accessToken: string,
): Promise<{ prompts: UserPrompt[]; error?: string }> {
  const res = await fetch("/api/user/prompts", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as
    | { prompts?: unknown; error?: string }
    | null;
  if (!res.ok) {
    return {
      prompts: [],
      error: data?.error ?? `Request failed (${res.status})`,
    };
  }
  const prompts = normalizeUserPromptsPayload(data?.prompts);
  return { prompts };
}

export async function putUserPromptsToAccount(
  accessToken: string,
  prompts: UserPrompt[],
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/user/prompts", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ prompts }),
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    return { ok: false, error: data?.error ?? `Request failed (${res.status})` };
  }
  return { ok: true };
}
