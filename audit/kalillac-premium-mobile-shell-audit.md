# Kalillac Premium Mobile Shell Audit

**Audit date:** 2026-09-22  
**Scope:** Milestone 1B mobile shell, observation only  
**Application code changed:** None

## Executive summary

Kalillac has a coherent, calm foundation: the shell is readable, the six primary tasks are immediately understandable, the tab structure is familiar, and the privacy boundary is unusually explicit for a prototype. It is not yet ready to present as a commercial AI product.

The release blockers are primarily product truth and trust issues rather than raw visual defects:

1. Demo and simulation controls are reachable from normal Settings and the paywall.
2. The Plus flow presents a provisional price and simulated purchase/restore outcomes as if they were a customer flow.
3. The privacy promise (“vanish automatically”) is stronger than the current in-memory behavior and is surrounded by prototype caveats.
4. Offline/API failures are rendered as assistant message text without a retry or recovery treatment.
5. Starting a new conversation clears every active temporary session, which can silently discard work.
6. Several important controls, especially mode chips and modal close buttons, do not meet a reliable 44pt touch/accessibility baseline.

The visual direction should be preserved, but the next pass should be a single release-readiness refinement pass: first remove or gate prototype surfaces, then make temporary-chat lifecycle and error states trustworthy, then refine the home hierarchy, composer, mode control, and accessibility/native polish.

## Method and evidence

### Preview review

The running Expo preview was checked at:

- 390 × 844, representative of a current compact iPhone viewport.
- 430 × 932, representative of a larger iPhone viewport.
- Light theme in the rendered preview.
- Dark theme behavior reviewed from the existing theme tokens and every screen’s semantic color usage. Physical-device color rendering was not claimed.

Captured evidence:

- `audit/onboarding-light-390.jpg`
- `audit/onboarding-large-430.jpg`
- `audit/home-tabs-390.jpg`
- `audit/saved-empty-390.jpg`
- `audit/settings-390.jpg`
- `audit/privacy-390.jpg`
- `audit/providers-390.jpg`
- `audit/paywall-390.jpg`

### Entry points reviewed

- Onboarding and redirect behavior.
- Home, all six task cards, New Conversation, and tab navigation.
- Temporary chat source flow, task parameters, streaming fixture behavior, mode selector, composer, attachments, save, edit, copy, share, regenerate, stop, and end-chat actions.
- Saved empty state, saved-row actions, delete behavior, and snapshot behavior.
- Settings, theme/haptics/reduce-motion preferences, privacy, providers, and Plus.
- Simulated offline/API failure paths, corrupted snapshot path, and the global `ErrorFallback`.
- Theme palette, typography scale, spacing, radii, safe-area usage, and touch-target sizing.

The dynamic chat screen could not be meaningfully captured by a direct deep link because its session exists only in the in-memory repository and is created by pressing New Conversation. Its behavior was therefore reviewed from the route and repository implementation, while the surrounding screens were captured from the running preview.

## A. Release-blocking visual and product issues

These should be resolved before the shell is shown as a real customer-ready product. They are ordered by trust and user-impact risk, not by implementation size.

### A1. Prototype controls are exposed in the normal customer Settings path

**Screen/components:** `app/(app)/(tabs)/settings.tsx`, Settings screenshot.

**Observed:** The visible **DEVELOPER / DEMO** section contains:

- Simulate Offline Mode.
- Simulate API Errors.
- Simulate Saved Chat Corruption.

These are not behind a development build guard or an internal gesture. They sit below ordinary privacy settings and are reachable by every user.

**Impact:** A customer can put the app into a fake failure state or corrupt a saved snapshot, then reasonably interpret the resulting behavior as an app defect. This also makes a store-review or stakeholder demo look unfinished.

**Recommendation:** Remove from production builds or gate behind a development-only surface that cannot be reached in the customer navigation. Keep an internal QA path separately so the state coverage is not lost.

### A2. Plus is a simulated purchase flow with a provisional price

**Screen/components:** `app/(app)/paywall.tsx`, `contexts/SubscriptionContext.tsx`.

**Observed:** The screen says “Preview the planned Plus experience,” displays **$7.99 / month**, and offers **Simulate subscription** and **Restore Purchases (demo)**. Pressing either action opens a simulated outcome chooser. The entitlement exists only in React state and is not durable.

**Impact:** This is not a shippable commerce experience. Even with the disclaimers, a real user sees a price and a purchase-shaped CTA without a real product entitlement, store transaction, restore guarantee, or terms context. It creates trust, review, and compliance risk.

**Recommendation:** Keep the screen internal until billing, entitlements, price configuration, restore behavior, and required purchase/legal copy are real and verified. If the screen must remain in a stakeholder build, label it unmistakably as internal and keep it out of the customer route.

### A3. Privacy language and actual lifecycle behavior do not yet align

**Screen/components:** `app/onboarding.tsx`, `app/(app)/privacy.tsx`, `app/(app)/chat/[id].tsx`, `contexts/ChatRepositoryContext.tsx`.

**Observed:**

- Onboarding says temporary conversations “vanish automatically.”
- The privacy screen explains that the current behavior is memory-only, reload clears it, there is no expiration service, and this is not a guarantee of forensic erasure or operating-system behavior.
- Saved copies are explicitly unencrypted, non-durable, and lost on reload.
- The chat banner repeats “Temporary · Demo responses · Memory only.”

**Impact:** The product is honest in the detailed screen, but the first promise is still stronger than the implementation. Users should not need to reach a dense caveat page to understand that “private” currently means a prototype in-memory lifecycle, not verified secure deletion or encrypted storage.

**Recommendation:** Define the production data model and deletion promise first. Then make every entry point use the same verified claim. Until that exists, keep the product clearly in preview/internal status and avoid presenting “private by default” as a production security guarantee.

### A4. Offline and API failures look like assistant content instead of recoverable app errors

**Screen/components:** `app/(app)/chat/[id].tsx`, `ErrorFallback.tsx`.

**Observed:** Simulated offline/API failures update the AI message content to strings such as “Error: Simulated Offline Mode.” or “Error: Simulated API Failure.” The message remains in the normal assistant bubble, with no retry action, connection status, or clear distinction between an answer and a failed request. The global error fallback only covers render-level crashes and offers a generic “Try Again.”

**Impact:** A customer cannot tell whether the model answered, the request failed, or the content itself contains an error. There is no direct recovery path for the most important interaction in the app.

**Recommendation:** Design explicit inline request states: failed, offline, cancelled, and retrying. Preserve the user prompt, provide retry/copy-safe recovery actions, and ensure a failed request is not represented as an ordinary assistant answer.

### A5. New Conversation clears all active temporary sessions without an explicit confirmation

**Screen/components:** `app/(app)/(tabs)/index.tsx`, `contexts/ChatRepositoryContext.tsx`.

**Observed:** The Home `handleNewChat` path calls `clearAllTemporary()` before creating the new session. The repository implementation removes the entire active-session collection, not only the current session.

**Impact:** If a user opens more than one temporary conversation, tapping New Conversation silently removes the earlier temporary conversations. This is especially risky because the Home CTA is the primary action and does not communicate destructive behavior.

**Recommendation:** Choose and document one lifecycle model: preserve a temporary-session list until explicit End Chat/expiry, or intentionally clear it with a clear user-facing privacy action. Do not silently discard multiple sessions from a routine creation action.

### A6. Important controls miss a dependable touch and accessibility baseline

**Screen/components:** chat mode selector, modal close controls in privacy/providers/paywall, chat action controls.

**Observed:**

- Mode pills use only 4pt vertical padding and have no explicit accessibility role/label or selected-state announcement.
- Privacy, Providers, and Paywall use a bare 28pt close icon with `onPress`, rather than a 44pt hit area with an accessible label.
- Home task cards and the main CTA are comfortably tappable, and many chat actions do use 44pt minimum containers, so the issue is inconsistent rather than universal.

**Impact:** Small controls are harder to use reliably, particularly with VoiceOver, larger text, or one-handed use. The mode selector is a central product control, not a decorative chip.

**Recommendation:** Standardize 44pt minimum hit areas, explicit roles/labels, selected-state announcements, and keyboard/screen-reader order for all primary controls. Test with VoiceOver and Dynamic Type before calling the shell accessible.

## B. High-value refinements

These are not all blockers individually, but they determine whether the product feels intentional and premium after the release risks above are fixed.

### B1. Home task grid is clear but visually generic and too evenly weighted

**Screen/components:** `app/(app)/(tabs)/index.tsx`, six `ActionCard` instances.

**Observed:** Research, Code, Study, Search, Analyze, and Create form a uniform 2-column, 3-row grid. Every card uses the same surface, border, icon container, title treatment, and small description. At 390pt wide, the cards fit without clipping, but the grid occupies most of the first screen and all six actions have equal visual priority. The screenshot reads as a standard AI starter template rather than a Kalillac-specific workspace.

**Recommendation:** Preserve the six-task coverage but establish a clearer hierarchy: one primary entry point, a compact secondary task treatment, or a recent/continue area. Add a distinct Kalillac signature through content hierarchy and interaction behavior rather than adding decorative cards. Validate the result on the compact viewport so the first screen remains scannable.

### B2. Task cards do not make the difference between the six modes legible enough

**Screen/components:** Home cards and `MockChatService`.

**Observed:** The descriptions are understandable but broad: “Deep dive with citations,” “Explore sample sources,” “Compare the trade-offs,” and similar. Search maps to the Research fixture, and selecting Auto/Fast/Smart/Deep changes gating/metadata more than the visible response behavior in the shell.

**Recommendation:** Define the user promise for each task and mode, then make the selected task and selected mode visibly affect the chat setup and response treatment. Keep sample fixtures clearly marked as such; do not imply that sample citations are live research.

### B3. Mode selection is present but lacks context and persistent clarity

**Screen/components:** chat mode selector in `app/(app)/chat/[id].tsx`.

**Observed:** Auto, Fast, Smart, and Deep appear as four small pills above the composer. The active state is visually inverted, but there is no explanation of speed, quality, privacy, allowance, or what changes when a user selects a mode. Smart and Deep are gated only after send, so the user learns about the Plus requirement late.

**Recommendation:** Make the mode control a deliberate, accessible selector with short explanatory context and an upfront Plus boundary. Decide whether mode selection belongs to the session state and ensure the visible selection, session metadata, and generated behavior stay synchronized.

### B4. Composer is structurally solid but still reads as a prototype

**Screen/components:** chat composer, attachment fixture picker, streaming marker.

**Observed:** The composer has a good basic hierarchy: attach, multiline text input, send/stop, safe-area bottom padding, and a 44pt control baseline for the larger actions. However, attachment selection opens a “Demo attachment” fixture chooser; the response stream appends a literal block cursor; and the screen-level banner says “Demo responses.”

**Recommendation:** Preserve the current composer proportions and keyboard behavior. Replace fixture-only affordances with a real capability boundary, remove implementation-language from customer UI, and use a production-quality streaming/typing state that also supports cancellation and failure recovery.

### B5. Message presentation needs a stronger content hierarchy for research and code

**Screen/components:** message bubbles and markdown rules in `app/(app)/chat/[id].tsx`.

**Observed:** AI messages have an avatar, bubble, markdown, and copy/share/regenerate actions. The message width is capped at 85%, which keeps reading comfortable. Code fences use lightweight token coloring and wrap each line in a flex row; long code and tables are not given a dedicated overflow or content-navigation treatment. The same bubble treatment is used for research, code, study, and analysis.

**Recommendation:** Keep the readable 16pt body and generous message width. Introduce content-specific hierarchy for code, tables, citations, and source lists, with robust long-content behavior. Keep actions discoverable without making every answer look like a floating card.

### B6. Saved is honest but has weak discoverability and low utility in its empty state

**Screen/components:** `app/(app)/(tabs)/saved.tsx`.

**Observed:** The empty state is clean and appropriately text-based. The header prominently says that the saved state is memory-only and disappears on reload. Existing rows open on tap and delete only on long press; there is no visible delete affordance or obvious continuation CTA.

**Recommendation:** Preserve the simple empty state and explicit persistence note. Add a direct path to start a conversation, make row actions discoverable and accessible, and distinguish “saved snapshot” from “active temporary chat” in the information architecture.

### B7. Privacy and provider screens are transparent but too dense for a premium mobile product

**Screen/components:** `privacy.tsx`, `providers.tsx`.

**Observed:** The screens do an excellent job of refusing to overclaim, but the privacy screen is a long uninterrupted paragraph on a 390pt viewport, and the providers screen presents several dense roadmap cards. Both use a small close icon at the top without a full hit target.

**Recommendation:** Keep the factual boundaries and uncertainty. Reformat into short sections with scannable labels, status language, and progressive disclosure. Make the distinction between “connected,” “planned,” and “not available” visually immediate.

### B8. Contrast and theme behavior need an accessibility pass, especially for tertiary content

**Screen/components:** `constants/Theme.ts`, tab bar, empty states, message actions.

**Observed:** The main light/dark surfaces and primary text have a strong, restrained contrast relationship. Tertiary colors are intentionally subdued: light `#A1A1A5` and dark `#48484A` are used for inactive tab icons, empty-state icons, and secondary action icons. These are likely too low-contrast for important meaning at small sizes. Caption text is also 12pt in several dense cards.

**Recommendation:** Run WCAG contrast checks on every semantic text/icon pairing in both themes, including inactive tabs and disabled states. Support Dynamic Type and verify card wrapping, privacy text, provider cards, paywall copy, and the composer at larger text sizes.

### B9. Native iOS polish is promising but should be validated on-device

**Screen/components:** tab layout, safe-area handling, haptics, reduce-motion preference, keyboard controller.

**Observed:** The shell uses a blurred tab background, safe-area insets, haptics, reduce-motion state, Inter font loading, and the keyboard controller. These are good foundations. The preview is still rendered through React Native Web and cannot confirm native tab-bar, keyboard, Dynamic Island, VoiceOver, or app-switcher privacy behavior.

**Recommendation:** Treat the current BlurView tab bar as a good fallback, then validate the native iPhone presentation before finalizing. Keep the existing privacy overlay behavior, but verify it on the app-switcher snapshot and with the device’s native lifecycle.

## C. Strengths to preserve

### C1. Privacy intent is visible early and consistently

The onboarding feature list, chat banner, save confirmation, privacy route, and providers route all make the prototype boundary visible. This is stronger than silently implying secure storage or live AI. Preserve the directness while replacing preview-only caveats with verified production facts later.

### C2. The base visual system is disciplined

The shell uses a small semantic palette, Inter weights, predictable 4/8/16/24/32/48 spacing, and a restrained radius scale. Cards and buttons are consistent across Home, Settings, Providers, and Plus. Avoid adding visual noise or a large card taxonomy in the next pass.

### C3. Home is immediately understandable

The greeting, short prompt, six recognizable icons, short descriptions, and prominent New Conversation CTA make the first action obvious. The six cards do not require explanation to understand at a basic level.

### C4. Core chat mechanics are represented

The shell includes multiline input, stop while streaming, attachment state, save/update-save, copy, share, regenerate, edit, mode state, and an explicit End Chat path. The 44pt action containers and safe-area-aware composer are good structural choices to retain.

### C5. The preview does not pretend that mock data is live

The mock service labels sample answers and example sources, and the provider screen says no provider is connected. This discipline should continue through production configuration and QA builds.

### C6. Failure testing is intentionally represented

Offline, API error, save failure, and corrupted snapshot paths exist. The implementation of the customer-facing treatments needs work, but the existence of those test paths is valuable and should be preserved behind a QA-only surface.

### C7. Settings includes user-respectful controls

Haptics, reduce motion, light/dark selection, clear temporary chats, and an app-switcher privacy overlay show good attention to user control and privacy. Their behavior should be retained while the presentation and production lifecycle are finalized.

## D. Development/demo elements that must not ship in the customer experience

| Surface | Observed demo language/behavior | Production action |
| --- | --- | --- |
| Onboarding | “Milestone 1 Demo,” “Local Encryption (Pending),” “Mock models,” and a frontend-shell disclaimer | Replace with verified product claims or keep the entire route out of the customer build |
| Settings | **DEVELOPER / DEMO** section with offline, API-error, and corruption simulators | Remove from production navigation; retain only in a QA/development surface |
| Plus | “Simulate subscription,” “Restore Purchases (demo),” simulated outcome chooser, provisional price, mock in-memory entitlement | Hide until real billing and entitlement behavior are implemented and reviewed |
| Providers | “Planned providers,” unverified model/retention claims, no connected provider | Hide from customer navigation or convert to a verified connection/status surface |
| Chat banner | “Temporary · Demo responses · Memory only” | Keep only while explicitly in preview; replace with verified lifecycle/status language in production |
| Attachments | Fixture chooser, “Demo attachment,” fake rejected-file path, no file read/upload | Remove from customer builds until the real capability and permission/error paths exist |
| Responses/citations | Static fixture answers, example source links, “sample research answer,” no live provider/search request | Keep in fixture QA builds only; never present as live research or personal analysis |
| Inline failure text | “Error: Simulated Offline Mode.” and “Error: Simulated API Failure.” in assistant bubbles | Replace with customer-facing request-state components and keep simulation only as an internal test mechanism |
| Error details | ErrorFallback’s error-detail button and modal are already `__DEV__`-gated | Preserve the guard; do not expose stack traces in production |

## E. One consolidated refinement scope for the later implementation pass

The next implementation should be one coordinated release-readiness pass, not a series of isolated visual tweaks. The order below prevents polish work from encoding the wrong product promises.

### Phase 1 — establish the production truth boundary

- Remove or development-gate every demo control and simulation route listed in section D.
- Decide whether this build is an internal preview or a customer-facing product; do not mix the two in the same normal navigation.
- Define the verified temporary-chat lifecycle, saved-chat lifecycle, and deletion promise before changing privacy copy.
- Replace provisional Plus presentation with either a real billing path or an internal-only preview surface.
- Replace planned/unverified provider claims with actual connection status or hide the route.

### Phase 2 — make chat lifecycle and failure states trustworthy

- Stop New Conversation from silently clearing unrelated active sessions, or make the destructive privacy behavior explicit and intentional.
- Add explicit offline, request-failed, cancelled, and retrying states that are visually distinct from assistant content.
- Preserve the prompt on failure and provide a retry path.
- Make mode selection, session state, allowance gating, and response behavior consistent.
- Define how save/update-save behaves under failure and how snapshots are represented after reload.

### Phase 3 — refine the primary product surface

- Retain the six Home tasks but rebalance their hierarchy so the screen is less template-like and more distinctly Kalillac.
- Give each task and model mode a clear, truthful promise.
- Preserve the existing composer structure, safe-area behavior, and 44pt action containers while replacing fixture-only affordances.
- Improve message hierarchy for code, tables, citations, and long answers without turning every answer into a card.
- Make Saved useful and discoverable without weakening the explicit persistence boundary.

### Phase 4 — accessibility and native iOS validation

- Standardize 44pt hit areas, explicit roles/labels, selected-state announcements, and accessible close buttons.
- Check light/dark contrast for tertiary text, icons, tab states, disabled controls, error states, and bubbles.
- Test Dynamic Type, VoiceOver, reduce motion, keyboard presentation, safe areas, compact iPhone dimensions, and app-switcher privacy on a physical iPhone.
- Validate the tab-bar presentation against the intended iOS version and keep the current blur treatment as a fallback where appropriate.

### Definition of done for that later pass

- No customer-reachable simulator, fixture picker, “planned” provider capability, or fake purchase outcome remains.
- Privacy, persistence, and subscription copy matches implemented behavior.
- A failed request is never mistaken for a completed AI answer and can be retried.
- New Conversation cannot silently discard unrelated user work.
- Home, chat, Saved, Settings, Privacy, Providers, and Plus remain coherent in both themes at compact and large iPhone sizes.
- VoiceOver and Dynamic Type checks pass for the primary journeys, and all primary controls have reliable touch targets.
