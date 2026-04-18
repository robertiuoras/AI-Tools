# AI workers for this repo

A short menu of AI-driven tools that scan / fix code on a schedule, plus how
to enable each one for `AI-Tools`.

## 1. Cursor BugBot (recommended)

Cursor's hosted PR reviewer. Comments inline on every pull request with bug
risks, type holes, security issues, leftover `console.log`s, missing error
handling, and obvious refactors. **Free for individual Cursor accounts.**

### Enable

1. Go to <https://cursor.com/dashboard> → **BugBot**.
2. Click **Connect GitHub** and grant access to `robertiuoras/AI-Tools`.
3. Choose **Run on every PR** (default).
4. (Optional) `.cursor/bugbot.yml` lets you tune severity:

   ```yaml
   # .cursor/bugbot.yml
   severity: medium # low | medium | high
   include:
     - "app/**"
     - "lib/**"
     - "components/**"
   exclude:
     - "**/*.test.ts"
     - ".next/**"
     - "supabase/sql/**"
   ```

### Use

Open a PR → wait ~60 s → BugBot leaves inline comments. Reply with
`@cursor please refactor this to async/await` and BugBot will push a commit
fixing it on the same branch.

---

## 2. Cursor Background / Cloud Agents

Long-running agents you launch from the Agents pane. Each gets its own git
worktree, runs autonomously, and opens a PR back to `main` when done.

Good first jobs to try:

- "Sweep `app/api/**` and add Zod validation for every request body"
- "Add `aria-label` to every interactive element under `app/admin/**`"
- "Find files in `app/**` larger than 800 lines and propose a split"
- "Delete unused `.sql` files referenced nowhere — see
  `.cursor/rules/cleanup-superseded-files.mdc`"

Open Cursor → **Agents** sidebar → **+ New** → paste the prompt → tick
**Open PR when finished**.

---

## 3. Local pre-commit (already wired)

Husky + lint-staged runs **on every `git commit`** so we never push code that
fails lint or type-checks:

- `next lint --fix` on every staged `.ts/.tsx/.js/.jsx` file.
- `tsc --noEmit` on the whole project when any `.ts/.tsx` is staged
  (catches cross-file type breakage that per-file lint can't see).

You can also run them on demand:

```bash
npm run lint
npm run typecheck
```

To bypass in an emergency: `git commit --no-verify`.

---

## 4. GitHub Actions (optional next step)

If you want CI gates on top of pre-commit, add `.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build
```

This catches anything pre-commit was bypassed for, and is what BugBot reads
when deciding what changed.

---

## 5. What I'd skip for now

- **Sourcery / DeepSource** — overlaps with BugBot, less context-aware.
- **Custom GPT scripts run from cron** — without a code-context model
  they hallucinate refactors. Use Background Agents instead.
- **Renovate / Dependabot** — useful for deps, but unrelated to "scan my
  code for errors". Worth adding separately if you want auto-PRs for npm
  bumps.
