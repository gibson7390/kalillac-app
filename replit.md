# Kalillac

A privacy-first consumer iPhone AI application. Milestone 1 is a native Expo shell with mock services only, not a production AI service.

## Mandatory project boundaries

- The exclusive source repository is private `gibson7390/kalillac-app`. Its Git origin and GitHub private/read/write access were verified before application generation.
- Never connect to, read from, import, modify, or push to `gibson7390/kalillac`; it is the separate live web product.
- The canonical plan and latest architecture-approval revisions in `attached_assets/` govern scope. Preserve the approved architecture, and stop after Milestone 1 for review.
- All temporary conversation content and Milestone 1 saved snapshots stay in memory. Never persist content through filesystem, AsyncStorage, SQLite, SecureStore, query caches, navigation restoration, logging or diagnostics.
- Preferences alone may persist. Save is an explicit detached snapshot; only Update saved copy replaces it. Attachment files, images, filenames, extracted text, descriptions and metadata are excluded from snapshots.
- Milestone 1 does not implement the encrypted vault, backend, AI/search providers, purchases, authentication, databases or production metering. Do not portray mocks as production capabilities.
- Do not automatically load remote Markdown images.
- Final brand artwork/colors are not supplied; styling is provisional and replaceable through semantic tokens.
- Future production remains portable: Expo/TypeScript mobile, independently hosted Python/FastAPI, server-side provider keys, no mandatory Replit runtime services. CryptoKit/Keychain storage follows physical-iPhone shell approval, not before.
- Future backend expiry policy: approximately 60-minute idle timeout, 24-hour absolute backstop, immediate best-effort End/New Chat purge. Do not implement it in Milestone 1.

## Run & Operate

- Managed mobile preview: `artifacts/kalillac-mobile: expo`.
- Mobile package: `artifacts/kalillac-mobile`.
- The starter API, database libraries and Canvas predate the mobile shell and are not dependencies of its product behavior. Do not expand them for Milestone 1.

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
