# Kalillac Milestone 1 Handoff

## Status
Native Expo application shell implemented for review. Physical-iPhone acceptance is pending, not verified. No backend, paid AI/search APIs, RevenueCat, StoreKit purchases, database, production authentication, metering or encrypted native vault were connected or implemented. GitHub was authorized and the existing origin verified as private gibson7390/kalillac-app before code generation. No access to gibson7390/kalillac. This report does not claim changes have been pushed to GitHub.

## Architecture
Expo Router screens use React context for preferences, active conversations, memory-only saved snapshots and mock entitlements. MockChatService implements an abortable transport interface with static task-specific responses. Snapshot creation explicitly allowlists text and normal presentation fields, excluding attachments and all unspecified metadata. Opening a saved snapshot creates an independent temporary working copy. Only Update saved copy replaces the saved version. No application conversation content is sent over the network. Explicit Copy/Share and opening source links are user-initiated external boundaries.

## Privacy verification
Only PreferencesContext accesses AsyncStorage, with an allowlist for theme, onboarding, haptics and Reduce Motion. The application conversation, attachment and saved-state code has no filesystem, database, SecureStore, network request, diagnostics or logging persistence path. Images and raw HTML from Markdown are blocked. Snapshot tests verify metadata exclusion and independence after edits; stream tests verify multiple deltas, completion, immediate cancellation and no late emissions. This is code-level verification, not an OS-level audit or a claim of secure memory erasure. Development tools and operating-system behavior have not been audited on an iPhone.

## Checks performed
- Mobile TypeScript check passed after final implementation edits.
- Jest: two suites, four tests passed (snapshot exclusion/independence and stream completion/cancellation).
- Expo dependency compatibility check passed.
- Managed Metro server runs and bundles successfully.
- Browser-rendered native-app onboarding preview captured at screenshots/kalillac-shell.jpg.
- Desktop React Native DevTools reports a missing Linux libglib library; Metro and app preview still run. No dependency on that debugger at app runtime.

## Run on an iPhone
1. Open the Kalillac artifact and use Replit's Preview on your phone panel.
2. Open the project QR/link in a compatible Expo Go app on the iPhone. If the panel provides sign-in steps, follow those managed steps.
3. Start Workspace to enter the shell. Use Research, Study, Analyze, Code, Create or Search for deterministic demo responses.
4. In Settings, use mock offline/error and saved-corruption controls. Use the mock paywall choices to exercise success, failure, cancellation and restoration.
5. Save a conversation, continue it, open Saved Chats and compare the unchanged snapshot. Choose Update saved copy explicitly to replace it.
6. Reloading the application clears all temporary and saved conversations. Preferences may survive.

For portable source development, the Expo package is artifacts/kalillac-mobile. It uses standard Expo/React Native components, not a proprietary production backend. Replit-specific scripts provide the current development preview, not conversation processing. iOS release builds and physical-device signoff are not part of this delivery.

## Known limitations
- All AI, research, attachments, purchases and allowances are mocks. Attachments are fixtures; no real file reading, parsing or upload.
- Saved copies are memory-only, not encrypted and not durable.
- Citation links are illustrative sources, not evidence for a real researched answer.
- Native dialogs and share/clipboard behavior can differ in the web preview; a browser preview is not physical-iPhone acceptance.
- Physical keyboard handling, VoiceOver, Dynamic Type extremes, haptics and app-switcher overlay behavior have not been device-verified. Treat the overlay as best effort until that validation.
- Syntax coloring is a lightweight JS/TS keyword demonstration, not a full multi-language parser.
- Styling and scaffold icon remain provisional; no final Kalillac brand artwork has been supplied.
- No App Store/TestFlight submission or production security/retention claim is made. Stop at this milestone for review.

## Exact created mobile files
- artifacts/kalillac-mobile/app/(app)/chat/[id].tsx
- artifacts/kalillac-mobile/app/(app)/_layout.tsx
- artifacts/kalillac-mobile/app/(app)/paywall.tsx
- artifacts/kalillac-mobile/app/(app)/privacy.tsx
- artifacts/kalillac-mobile/app/(app)/providers.tsx
- artifacts/kalillac-mobile/app/(app)/(tabs)/index.tsx
- artifacts/kalillac-mobile/app/(app)/(tabs)/_layout.tsx
- artifacts/kalillac-mobile/app/(app)/(tabs)/saved.tsx
- artifacts/kalillac-mobile/app/(app)/(tabs)/settings.tsx
- artifacts/kalillac-mobile/app/index.tsx
- artifacts/kalillac-mobile/app.json
- artifacts/kalillac-mobile/app/_layout.tsx
- artifacts/kalillac-mobile/app/+not-found.tsx
- artifacts/kalillac-mobile/app/onboarding.tsx
- artifacts/kalillac-mobile/assets/images/icon.png
- artifacts/kalillac-mobile/components/Button.tsx
- artifacts/kalillac-mobile/components/ErrorBoundary.tsx
- artifacts/kalillac-mobile/components/ErrorFallback.tsx
- artifacts/kalillac-mobile/components/KeyboardAwareScrollViewCompat.tsx
- artifacts/kalillac-mobile/components/ThemedText.tsx
- artifacts/kalillac-mobile/constants/colors.ts
- artifacts/kalillac-mobile/constants/Theme.ts
- artifacts/kalillac-mobile/contexts/ChatRepositoryContext.tsx
- artifacts/kalillac-mobile/contexts/PreferencesContext.tsx
- artifacts/kalillac-mobile/contexts/SubscriptionContext.tsx
- artifacts/kalillac-mobile/expo-env.d.ts
- artifacts/kalillac-mobile/.gitignore
- artifacts/kalillac-mobile/hooks/useColors.ts
- artifacts/kalillac-mobile/jest.config.js
- artifacts/kalillac-mobile/metro.config.js
- artifacts/kalillac-mobile/package.json
- artifacts/kalillac-mobile/.replit-artifact/artifact.toml
- artifacts/kalillac-mobile/scripts/build.js
- artifacts/kalillac-mobile/server/serve.js
- artifacts/kalillac-mobile/server/templates/landing-page.html
- artifacts/kalillac-mobile/services/MockChatService.ts
- artifacts/kalillac-mobile/__tests__/snapshot.test.ts
- artifacts/kalillac-mobile/__tests__/stream.test.ts
- artifacts/kalillac-mobile/tsconfig.json
- artifacts/kalillac-mobile/utils/snapshot.ts
- artifacts/kalillac-mobile/utils/uuid.ts

## Other changed/created files
- pnpm-lock.yaml (mobile dependencies)
- replit.md (approved project constraints and mobile run context)
- screenshots/kalillac-shell.jpg (preview capture)
- docs/MILESTONE_1_REPORT.md (this report)

## Dependency manifest
The complete declared package list follows, including scaffold packages. Not all scaffold packages are imported by the shell. No provider/subscription SDK was added. Main runtime roles: Expo/Router/native UI; bundled Inter typography; Markdown rendering; clipboard/share and haptics; AsyncStorage for preferences only. Jest/ts-jest are test tooling.

| Package | Declared version |
| --- | --- |
| @babel/core | ^7.25.2 |
| @expo-google-fonts/inter | ^0.4.0 |
| @expo/vector-icons | ^15.0.2 |
| @jest/globals | ^30.5.2 |
| @react-native-async-storage/async-storage | 2.2.0 |
| @stardazed/streams-text-encoding | ^1.0.2 |
| @tanstack/react-query | catalog: |
| @types/jest | ^29.5.14 |
| @types/react | ~19.2.2 |
| @types/react-dom | ~19.2.2 |
| @ungap/structured-clone | ^1.3.0 |
| @workspace/api-client-react | workspace:* |
| babel-plugin-react-compiler | ^19.0.0-beta-e993439-20250117 |
| create-launch | 0.3.6 |
| expo | ~57.0.7 |
| expo-blur | ~57.0.2 |
| expo-clipboard | ^57.0.2 |
| expo-constants | ~57.0.6 |
| expo-crypto | ^57.0.3 |
| expo-font | ~57.0.1 |
| expo-glass-effect | ~57.0.1 |
| expo-haptics | ~57.0.1 |
| expo-image | ~57.0.1 |
| expo-image-picker | ~57.0.5 |
| expo-linear-gradient | ~57.0.1 |
| expo-linking | ~57.0.3 |
| expo-location | ~57.0.5 |
| expo-router | ~57.0.7 |
| expo-splash-screen | ~57.0.4 |
| expo-status-bar | ~57.0.1 |
| expo-symbols | ~57.0.1 |
| expo-system-ui | ~57.0.1 |
| expo-web-browser | ~57.0.1 |
| jest | ^29.7.0 |
| react | 19.2.3 |
| react-dom | 19.2.3 |
| react-native | 0.86.3 |
| react-native-gesture-handler | ~2.32.0 |
| react-native-keyboard-controller | 1.21.9 |
| react-native-markdown-display | ^7.0.2 |
| react-native-reanimated | 4.5.1 |
| react-native-safe-area-context | ~5.7.0 |
| react-native-screens | ~4.26.0 |
| react-native-svg | 15.15.4 |
| react-native-web | ~0.21.0 |
| react-native-worklets | 0.10.1 |
| ts-jest | ^29.4.12 |
| typescript | ~6.0.3 |
| zod | catalog: |
| zod-validation-error | ^3.4.0 |
