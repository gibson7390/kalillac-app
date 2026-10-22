# Kalillac mobile app — instructions for Claude Code

## Agent roles

`CLAUDE.md` and `AGENTS.md` set the same project safety requirements: repository identity,
the `kalillac-ai` boundary, privacy guarantees and secret handling. Each file also adds
operating restrictions for its own agent's role:

- Claude Code (this file) is the implementation agent. It may edit files within the scope a
  task authorizes.
- Codex (`AGENTS.md`) is the independent reviewer and works read-only by default.

The two roles have different permissions, but the project boundaries are the same for both
and do not contradict each other. Keep the shared requirements identical in both files when
either changes.

## Repository identity

- Repository: `gibson7390/kalillac-app` (the Kalillac iPhone application).
- Local path: `/home/kalillac/projects/kalillac-app` on Ubuntu under WSL, edited from VS Code.
- Before any change, confirm the Git remote, branch and working-tree state match the task.
  If they differ from what the task states, stop and report.

## Project boundary

- This repository is separate from the Kalillac website/backend repository, `kalillac-ai`.
- Never access, modify, deploy, synchronize or import code from `kalillac-ai` unless a task
  explicitly authorizes it.
- Do not assume similarly named projects share files, branches, deployments, databases or
  credentials.

## Layout

- Mobile app (React Native / Expo, Expo Router): `artifacts/kalillac-mobile/`
  - Backend transport: `services/KalillacChatService.ts`, `services/streamProtocol.ts`
  - Saved chats: `services/savedChatStore*.ts`, `contexts/ChatRepositoryContext.tsx`
  - AI-processing consent: `services/aiProcessingConsent*.ts`
- Backend (Python FastAPI): `artifacts/api-server/`
  - Entry point: `fastapi_app.py` (`fastapi_app:app`)
  - Providers: `provider.py` (OpenRouter), `search_provider.py` (Tavily)
  - Routing, limits and reliability: `routing.py`, `search_routing.py`, `runtime_config.py`,
    `reliability*.py`, `request_limits.py`, `usage_accounting.py`
- The Express files in `artifacts/api-server/src/`, `lib/db`, `lib/api-*` and
  `artifacts/mockup-sandbox` are Replit-era leftovers, not part of the running app.
- `replit.md` and older docs may be out of date. Verify behavior in the code itself.

## Local environment

- Python 3.13 virtualenv: `/home/kalillac/.virtualenvs/kalillac-app`
- JavaScript dependencies: pnpm workspace with a frozen lockfile.
- Backend: from `artifacts/api-server`,
  `/home/kalillac/.virtualenvs/kalillac-app/bin/python -m uvicorn fastapi_app:app --host 127.0.0.1 --port 8080`
- Mobile: `EXPO_PUBLIC_KALILLAC_API_URL=http://localhost:8080 pnpm --filter @workspace/kalillac-mobile start`
  (the `dev` script requires Replit variables and does not work locally).

## How to work

- Inspect the actual code before changing it; do not rely on documentation alone.
- Make focused, incremental changes limited to the task. No unnecessary architectural
  rewrites, refactors or renames.
- Match the surrounding code's style and conventions.
- Do not add, remove or update dependencies or lockfiles unless the task authorizes it.
- Do not change provider routing, model selection, search policy, rate limits, usage or cost
  limits unless the task authorizes it.
- Do not commit, push, merge, reset, rebase or deploy unless the task explicitly authorizes it.
- Do not run live OpenRouter or Tavily requests unless the task authorizes it. Tests use mocks.

## Privacy guarantees (must be preserved)

- Conversations are temporary by default; there is no automatic persistent history.
- Saving is an explicit snapshot action. On iOS, Saved chats are encrypted on the device
  (AES-256-GCM, key in the Keychain via SecureStore).
- The AI-processing consent gate must be checked before every inference request.
- Never log conversation content, prompts, search queries, provider responses or keys,
  on the device or on the backend.
- Provider credentials live only on the backend. Never embed them in the mobile app and never
  put secrets in `EXPO_PUBLIC_*` variables (Expo inlines those into the app bundle).
- Requests are processed by external AI providers through the Kalillac backend. Never
  describe them as end-to-end encrypted or entirely on-device.

## Secrets

- Never read, print, request, copy or commit API keys or other secrets.
- Do not create `.env` files unless the task authorizes it; only `.env.example` /
  `.env.sample` templates with placeholder values may be committed.

## Validation and reporting

- After changes, run the relevant tests:
  - Mobile: `pnpm --filter @workspace/kalillac-mobile test` and `... typecheck`
  - Backend: from `artifacts/api-server`,
    `/home/kalillac/.virtualenvs/kalillac-app/bin/python -m pytest -q`
- Report the exact modified files, the commands run and their results, including failures
  and anything skipped.
