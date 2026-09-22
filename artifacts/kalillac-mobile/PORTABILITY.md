# Kalillac Milestone 1A portability audit

## Clean-checkout commands

From this directory with a current Node.js release and pnpm installed:

```sh
pnpm install
pnpm start
```

Expo can also be invoked directly:

```sh
pnpm exec expo start
```

Verification:

```sh
pnpm typecheck
pnpm test
CI=1 pnpm exec expo install --check
```

The repository root lockfile remains the authoritative lockfile when this
package is checked out as part of the monorepo. The package manifest contains
only explicit npm-compatible version ranges and has no workspace dependency,
so the mobile directory can also be copied to a standalone pnpm project and
installed without the repository's workspace packages or catalog.

## Removed dependencies

- `@workspace/api-client-react`: unused and coupled installation and TypeScript
  project references to a repository-local package.
- `@stardazed/streams-text-encoding` and `@ungap/structured-clone`: unused
  compatibility shims.
- `expo-image-picker` and `expo-location`: unused sensitive-capability modules.
- `expo-constants`, `expo-glass-effect`, `expo-image`,
  `expo-linear-gradient`, `expo-status-bar`, `expo-symbols`,
  `expo-system-ui`, and `expo-web-browser`: unused by the current shell.
- `zod` and `zod-validation-error`: unused validation packages. Removing Zod
  also removed the remaining catalog-version reference.

`@tanstack/react-query` remains in use by the root provider and now has an
explicit npm version range instead of a catalog reference.

## Retained dependencies and roles

- Expo core, Router, Linking, splash screen, React, and React Native provide
  the native application runtime and route entrypoint.
- Inter fonts, Expo Font, vector icons, blur, and haptics are imported by the
  current interface.
- AsyncStorage stores only allowlisted non-content preferences.
- React Query supplies the in-memory query provider. It has no persistence
  adapter or storage integration.
- Metro Config, Gesture Handler, Keyboard Controller, Safe Area Context, Screens,
  Reanimated, Worklets, and SVG support the current native component stack and
  its declared peer requirements.
- Clipboard, Crypto, and Markdown Display are used by chat presentation and
  identifier generation.
- React DOM and React Native Web support Expo's optional browser preview.
- Babel, TypeScript, Jest, ts-jest, type packages, and the React compiler
  plugin are development/build tooling. The compiler plugin corresponds to the
  enabled `reactCompiler` Expo experiment.
- `create-launch` is used only by the Replit-specific `dev` script.

## Replit-specific conveniences

The native production entrypoint is `expo-router/entry`; it does not import
artifact metadata, the preview server, the landing-page template, build
scripts, `create-launch`, or Replit environment variables.

The `dev` script and `.replit-artifact` metadata remain for the managed Replit
Expo preview. `scripts/build.js`, `server/serve.js`, and the landing page
produce and serve Replit's static Expo preview/deployment format. They are not
used by `pnpm start`, the Expo Router entrypoint, or a native application
bundle.

Outside Replit, use `pnpm start` rather than `pnpm dev`. The standard start
command requires no Replit services or environment variables.

## Privacy boundary

Temporary conversations and attachments live only in React memory. Saved
snapshots are also memory-only in Milestone 1A, and snapshot creation
allowlists fields while removing attachments and attachment-derived metadata.
There is no chat-content persistence path through AsyncStorage, files,
databases, SecureStore, navigation restoration, query-cache persistence,
diagnostics, or logs.

AsyncStorage persists only theme mode, haptics, reduce-motion, and onboarding
completion. Offline and API-error simulation flags remain memory-only.

## Verification results

Verified on September 22, 2026:

- Root install with the regenerated frozen lockfile: passed.
- Fresh standalone copy install with standard `pnpm install`: passed.
- Standalone `pnpm typecheck`: passed.
- Standalone `pnpm test`: 2 suites and 4 tests passed.
- `CI=1 pnpm exec expo install --check`: dependencies up to date.
- Standalone `pnpm start -- --localhost --port 8099`: Metro reached
  `packager-status:running`.
- Managed Replit preview restart and browser render: passed with the existing
  Milestone 1A interface unchanged.
- Static persistence-path audit and existing snapshot tests: no temporary
  conversation or attachment persistence path found.

On this Replit Linux host, Expo's optional React Native DevTools executable
reports a missing `libglib-2.0.so.0`; Metro continues to start and serve the
app. This host debugging-tool warning is not imported by or required for the
native production bundle.