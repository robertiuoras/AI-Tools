/** Prompt library categories (used for community + user prompts). */
export const PROMPT_CATEGORIES = [
  "Writing",
  "Coding",
  "Marketing",
  "Research",
  "Creative",
  "Productivity",
  "Business",
  "Learning",
] as const;

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export interface CommunityPrompt {
  id: string;
  category: PromptCategory;
  title: string;
  body: string;
}

/** Curated starter prompts — extend over time or move to DB later. */
export const COMMUNITY_PROMPTS: CommunityPrompt[] = [
  {
    id: "cw-1",
    category: "Writing",
    title: "Blog outline from topic",
    body: `Act as an editor. I want to write a blog post about: [TOPIC].
Audience: [AUDIENCE]. Tone: [TONE].
Give me: (1) 5 working titles, (2) a one-paragraph hook, (3) H2 outline with 2–3 bullet ideas per section, (4) a short CTA suggestion.`,
  },
  {
    id: "cw-2",
    category: "Writing",
    title: "Rewrite for clarity",
    body: `Rewrite the following text to be clearer and more concise. Keep the meaning and voice similar unless I ask otherwise. Use short paragraphs and plain language.

Text:
"""
[PASTE TEXT]
"""`,
  },
  {
    id: "cw-3",
    category: "Writing",
    title: "Email — professional follow-up",
    body: `Draft a short professional email to [RECIPIENT] following up on [CONTEXT]. Goal: [GOAL]. Max ~120 words. Include a clear subject line and one specific ask.`,
  },
  {
    id: "cc-1",
    category: "Coding",
    title: "Explain this code",
    body: `Explain this code step by step: what it does, edge cases, and possible bugs. Suggest one improvement.

\`\`\`[LANG]
[PASTE CODE]
\`\`\``,
  },
  {
    id: "cc-2",
    category: "Coding",
    title: "Generate tests",
    body: `Write unit tests for the following function using [FRAMEWORK]. Cover happy path, edge cases, and one failure case. Include brief comments only where non-obvious.

Code:
\`\`\`
[PASTE CODE]
\`\`\``,
  },
  {
    id: "cc-3",
    category: "Coding",
    title: "Debug an error",
    body: `I'm getting this error:
"""
[ERROR MESSAGE]
"""

Stack trace / context:
"""
[CONTEXT]
"""

What are the most likely causes and concrete steps to fix? If you need more info, list exactly what to provide.`,
  },
  {
    id: "cm-1",
    category: "Marketing",
    title: "Ad angles for a product",
    body: `Product/service: [PRODUCT]
Target customer: [CUSTOMER]
Main benefit: [BENEFIT]

Suggest 8 distinct ad angles (pain, aspiration, social proof, urgency, etc.). For each: one headline (max 8 words) + one sentence body hook.`,
  },
  {
    id: "cm-2",
    category: "Marketing",
    title: "Landing page section copy",
    body: `Write copy for these landing page sections: Hero (headline + subhead + primary CTA), 3 benefit bullets, short testimonial placeholder, FAQ (3 Q&As).

Product: [PRODUCT]
Differentiator: [DIFFERENTIATOR]`,
  },
  {
    id: "cm-3",
    category: "Marketing",
    title: "Social post batch",
    body: `Create 5 posts for [PLATFORM] about [TOPIC]. Mix formats: tip, story hook, question, myth-bust, CTA. Keep each under [WORD LIMIT] words. Include 3–5 relevant hashtags per post where appropriate.`,
  },
  {
    id: "cr-1",
    category: "Research",
    title: "Literature-style summary",
    body: `Summarize the key claims, methods, limitations, and implications of the following text. Use bullet points. Flag anything that seems uncertain or needs a primary source.

"""
[PASTE ABSTRACT OR ARTICLE]
"""`,
  },
  {
    id: "cr-2",
    category: "Research",
    title: "Compare options",
    body: `Compare these options for my decision: [OPTION A] vs [OPTION B] (add C if needed).

Criteria I care about: [CRITERIA].
Output: comparison table, then a recommendation with assumptions stated explicitly.`,
  },
  {
    id: "cr-3",
    category: "Research",
    title: "Interview question bank",
    body: `I'm interviewing for a [ROLE] at [TYPE OF COMPANY]. Generate 12 strong interview questions I should ask the interviewer, grouped by theme (role, team, success metrics, culture).`,
  },
  {
    id: "ccr-1",
    category: "Creative",
    title: "Brainstorm names",
    body: `Brainstorm 20 names for [PROJECT TYPE]. Constraints: [CONSTRAINTS]. For each name, note vibe in 2–3 words. Then pick top 5 with rationale.`,
  },
  {
    id: "ccr-2",
    category: "Creative",
    title: "Short story seed",
    body: `Genre: [GENRE]. Theme: [THEME]. Setting: [SETTING].

Write a 250-word story opening with a strong hook and one clear conflict. End on a line that invites continuation.`,
  },
  {
    id: "ccr-3",
    category: "Creative",
    title: "Image / video brief",
    body: `Write a detailed creative brief for [IMAGE OR VIDEO] for [BRAND OR PROJECT].

Include: mood, color palette, composition, subject, lighting, what to avoid, and 3 reference-style keywords.`,
  },
  {
    id: "cp-1",
    category: "Productivity",
    title: "Plan my week",
    body: `Here are my commitments and goals for the week:
"""
[LIST TASKS / GOALS]
"""

Assume ~[HOURS] focused hours per day. Propose a realistic schedule: deep work blocks, shallow tasks, and one "if nothing else" fallback task per day.`,
  },
  {
    id: "cp-2",
    category: "Productivity",
    title: "Meeting agenda",
    body: `Create a 30-minute meeting agenda for: [PURPOSE].

Attendees: [WHO]. Desired outcome: [OUTCOME].

Include time boxes, pre-reads if any, and a notes section with decisions / action items template.`,
  },
  {
    id: "cp-3",
    category: "Productivity",
    title: "Break down a goal",
    body: `Goal: [GOAL]
Deadline: [DATE]

Break this into milestones, weekly outcomes, and the very next 3 actions I can do in under 30 minutes each. Identify one likely bottleneck and how to mitigate.`,
  },
  {
    id: "cb-1",
    category: "Business",
    title: "One-pager pitch",
    body: `Help me draft a one-pager for [COMPANY / IDEA]: problem, solution, market, traction (or hypothesis), business model, team (optional), ask. Keep each section to 2–4 sentences.`,
  },
  {
    id: "cb-2",
    category: "Business",
    title: "Risk register starter",
    body: `For a project to [OUTCOME], list 10 risks (technical, people, market, legal, ops). For each: likelihood (L/M/H), impact (L/M/H), and one mitigation.`,
  },
  {
    id: "cb-3",
    category: "Business",
    title: "Stakeholder update",
    body: `Write a concise stakeholder update email: wins, blockers, asks, next steps. Context:
"""
[PASTE NOTES]
"""
Tone: [FORMAL / CASUAL]. Max ~200 words.`,
  },
  {
    id: "cl-1",
    category: "Learning",
    title: "Explain like I'm new",
    body: `Explain [CONCEPT] assuming I'm a beginner in [FIELD]. Use an analogy, a simple example, and 3 common misconceptions people have.`,
  },
  {
    id: "cl-2",
    category: "Learning",
    title: "Flashcard deck plan",
    body: `I'm studying [TOPIC] for [EXAM OR GOAL]. Generate 15 high-yield flashcard questions (front) and answers (back). Mark which are "must know" vs "nice to know".`,
  },
  {
    id: "cl-3",
    category: "Learning",
    title: "Practice problem set",
    body: `Create 5 practice problems for [TOPIC] at [DIFFICULTY] level. Include solutions with brief reasoning. Increase difficulty slightly from Q1 to Q5.`,
  },
];

export const USER_PROMPTS_STORAGE_KEY = "ai-tools-user-prompts-v1";

/**
 * Prompt "type" describes intent / shape of the prompt (vs the topical
 * category). Inspired by promptcowboy.ai's typology — answers questions
 * like "what is this prompt for?" rather than "what subject is it about?".
 */
export const PROMPT_TYPES = [
  "Agent",
  "Research",
  "Planning",
  "Automation",
  "Writing",
  "Analysis",
  "Coding",
  "Brainstorm",
  "Roleplay",
  "Other",
] as const;

export type PromptType = (typeof PROMPT_TYPES)[number];

export interface UserPrompt {
  id: string;
  category: PromptCategory;
  title: string;
  body: string;
  createdAt: string;
  /** Added in v2 — optional for backwards compatibility with v1 data. */
  type?: PromptType;
  tags?: string[];
  /** Short one-liner produced by the analyser to make the list scannable. */
  summary?: string;
}

export function isPromptCategory(s: string): s is PromptCategory {
  return (PROMPT_CATEGORIES as readonly string[]).includes(s);
}

export function isPromptType(s: string): s is PromptType {
  return (PROMPT_TYPES as readonly string[]).includes(s);
}

export function loadUserPrompts(): UserPrompt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(USER_PROMPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is UserPrompt =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as UserPrompt).id === "string" &&
          typeof (p as UserPrompt).title === "string" &&
          typeof (p as UserPrompt).body === "string" &&
          typeof (p as UserPrompt).category === "string" &&
          isPromptCategory((p as UserPrompt).category) &&
          typeof (p as UserPrompt).createdAt === "string",
      )
      .map((p) => {
        // Coerce v2 fields to safe defaults so the UI can rely on them.
        const type =
          typeof p.type === "string" && isPromptType(p.type) ? p.type : undefined;
        const tags = Array.isArray(p.tags)
          ? p.tags.filter((t): t is string => typeof t === "string").slice(0, 8)
          : undefined;
        const summary =
          typeof p.summary === "string" && p.summary.trim().length > 0
            ? p.summary.trim()
            : undefined;
        return { ...p, type, tags, summary };
      });
  } catch {
    return [];
  }
}

export function saveUserPrompts(list: UserPrompt[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_PROMPTS_STORAGE_KEY, JSON.stringify(list));
}

/** Append one prompt (e.g. from community “Save to mine”) without React state. */
export function appendUserPrompt(entry: UserPrompt) {
  saveUserPrompts([entry, ...loadUserPrompts()]);
}
