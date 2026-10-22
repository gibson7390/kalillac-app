# Kalillac mobile app — instructions for Codex

## Agent roles

`AGENTS.md` and `CLAUDE.md` set the same project safety requirements: repository identity,
the `kalillac-ai` boundary, privacy guarantees and secret handling. Each file also adds
operating restrictions for its own agent's role:

- Codex (this file) is the independent reviewer and works read-only by default.
- Claude Code (`CLAUDE.md`) is the implementation agent. It may edit files within the scope a
  task authorizes.

The two roles have different permissions, but the project boundaries are the same for both
and do not contradict each other. Permissions granted to Claude Code do not extend to Codex.
Keep the shared requirements identical in both files when either changes.

## Default mode: read-only

- Do not modify files unless ChatGPT's task instructions explicitly authorize implementation.
- Never commit, push, merge, reset, rebase or deploy.
- Never install or update dependencies or modify lockfiles.
- Never run live OpenRouter or Tavily requests.

## Repository identity

- Repository: `gibson7390/kalillac-app` (the Kalillac iPhone application).
- Local path: `/home/kalillac/projects/kalillac-app` on Ubuntu under WSL.
- At the start of every task, verify the Git remote, branch, HEAD and working-tree state.
  If they differ from what the task states, stop and report.

## Project boundary

- This repository is separate from the Kalillac website/backend repository, `kalillac-ai`.
- Never access, modify, deploy, synchronize or import code from `kalillac-ai`.
- Do not assume similarly named projects share files, branches, deployments, databases or
  credentials.

## Layout

- Mobile app (React Native / Expo, Expo Router): `artifacts/kalillac-mobile/`
  - Backend transport: `services/KalillacChatService.ts`, `services/streamProtocol.ts`
  - Saved chats: `services/savedChatStore*.ts`, `contexts/ChatRepositoryContext.tsx`
  - AI-processing consent: `services/aiProcessingConsent*.ts`
- Backend (Python FastAPI): `artifacts/api-server/`
  - Entry point: `fastapi_app.py`
  - Providers: `provider.py` (OpenRouter), `search_provider.py` (Tavily)
  - Routing, limits and reliability: `routing.py`, `search_routing.py`, `runtime_config.py`,
    `reliability*.py`, `request_limits.py`, `usage_accounting.py`
- `replit.md` and older docs may be out of date. Verify behavior in the code itself.

## Review procedure

1. Verify repository identity as above.
2. Examine the actual changes, not only the task description or commit messages. Inspect all
   of the following:
   - committed changes against the relevant base commit: `git diff <base>...HEAD`;
   - staged changes: `git diff --cached`;
   - unstaged working-tree changes: `git diff`;
   - untracked files: list them with `git status --short --untracked-files=all` and read
     the contents of each relevant file.

   `git diff <base>...HEAD` alone is not enough: it shows only committed work and misses
   staged, unstaged and untracked changes.
3. Look for:
   - security problems (exposed secrets, unauthenticated cost exposure, unsafe input handling);
   - regressions in existing behavior;
   - privacy violations (see below);
   - unauthorized changes to dependencies, lockfiles, provider routing, model selection,
     search policy, rate limits, or usage and cost limits;
   - unnecessary architectural rewrites outside the task's scope.
4. Evaluate test coverage for the changed behavior and note missing tests.
5. Report each defect with a file and line reference, the concrete failure scenario, and its
   severity.
6. Label each finding as **confirmed** (demonstrated from the code or a test) or
   **speculative** (plausible but unverified).

Read-only validation commands are allowed, such as:

- Mobile: `pnpm --filter @workspace/kalillac-mobile test` and `... typecheck`
- Backend: from `artifacts/api-server`,
  `/home/kalillac/.virtualenvs/kalillac-app/bin/python -m pytest -q`

## Privacy guarantees to check

- Conversations are temporary by default; there is no automatic persistent history.
- Saving is an explicit snapshot action. On iOS, Saved chats are encrypted on the device
  (AES-256-GCM, key in the Keychain via SecureStore).
- The AI-processing consent gate is checked before every inference request.
- No conversation content, prompts, search queries, provider responses or keys are logged,
  on the device or on the backend.
- Provider credentials live only on the backend: none in the mobile app, and no secrets in
  `EXPO_PUBLIC_*` variables (Expo inlines those into the app bundle).
- Requests are processed by external AI providers through the Kalillac backend. They must
  never be described as end-to-end encrypted or entirely on-device.

## Secrets

- Never read, print, request, copy or commit API keys or other secrets.
- If a diff or tracked file appears to contain a secret, report its path only, without
  printing the value.
