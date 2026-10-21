# iPhone chat-scroll regression and acceptance checklist

## Evidence and limits

- The user reports physical-iPhone failure with long fenced code; ordinary prose works and web preview does not reproduce it.
- This workspace is Linux, with no accessible iOS simulator or physical iPhone. UIKit gesture behavior and native Keychain operation have **not** been exercised here.
- **Root-cause hypothesis, not a confirmed native diagnosis:** the old fenced/indented-code wrappers used a horizontal ScrollView with React Native's default `flexGrow: 1` / `flexShrink: 1`, inside variable-height inverted FlatList cells with only maximum message widths. This left code viewport measurement to native scroll-view flex behavior. Nested horizontal gesture ownership is a second plausible contributor.
- Supporting source evidence: React Native `ScrollView.js` defines the flex defaults for `baseHorizontal`. The old two code wrappers did not override them or specify an axis lock/inset policy. No custom message-height estimates, `getItemLayout`, content-size callback, forced `scrollToEnd`/`scrollToOffset`, or application-level scroll disable was present. There was no fixed message height or height multiplier to directly explain a giant gap. iOS normally defaults to no clipped-subview removal; explicitly disabling it is defensive, not evidence that clipping caused the reported bug.
- The candidate fix uses one shared code viewport: natural vertical height (`flexGrow: 0`, `flexShrink: 0`), constrained width, horizontal scrolling, direction lock, no bounce or automatic insets. The parent list remains inverted, owns vertical travel, and explicitly retains tall cells. No code is truncated and no response length is reduced.
- Element/prop and parser tests establish the layout contract and complete fixture text, **not** native measurement or pan-recognizer acceptance.

## Local deterministic fixtures (no provider calls)

1. Reload this version of Kalillac in the existing Expo iPhone session.
2. Open **Settings → Developer Tools**. Turn off **Simulate Offline Mode** and **Simulate API Errors**.
3. Open **Local fixture: long-code (no provider)**.
4. This creates a new **temporary, unsaved** chat with one earlier user message and a deterministic assistant response. The response has 100 wide lines each of HTML, Python, and JavaScript, plus start/end markers.
5. The short and mixed entries use the same code path. Mixed adds prose around the code.
6. Follow-ups in development fixture chats stream locally. Synthetic message IDs also identify explicitly saved/reopened fixture copies, including after relaunch, without adding a storage preference. Ordinary chats still use the unchanged real transport.
7. Fixtures are visible only in development. Opening a fixture is not an implicit Save.

## Hide Expo's development overlay first

1. Tap the blue floating gear/Tools button.
2. In Expo's developer menu, switch **Tools button** off.
3. Dismiss the menu.
4. Shake the iPhone or use a three-finger long press if you need the menu again.
5. Check Kalillac's bookmark and Trash controls remain accessible.

This is Expo development tooling, not a Kalillac header element. A normal production/TestFlight **release** build does not include this debug overlay. This task does not create a build or change developer-menu preferences in application code. If your installed Expo version does not show the toggle, record that version; do not infer that closing the menu itself hides the button.

Sources checked:
- https://github.com/expo/expo/blob/sdk-57/packages/expo-dev-menu/ios/SwiftUI/DevMenuDeveloperTools.swift
- https://docs.expo.dev/versions/v57.0.0/sdk/dev-menu/

## Physical scroll retest

With the long-code fixture open:

1. Dismiss the keyboard. Find **FIXTURE END** at the bottom.
2. Scroll back through **JAVASCRIPT END/START**, **PYTHON END/START**, **HTML END/START**, and finally **LOCAL FIXTURE START** in the earlier user message.
3. Repeat with mostly vertical finger motions starting **inside** each code block, not just in the margins. The full transcript must remain reachable.
4. Swipe horizontally in each code block. Check wide-line endings are reachable, then immediately resume vertical scrolling.
5. Alternate horizontal and vertical gestures several times; there must be no persistent lock or giant unrelated blank region.
6. Verify the mode selector and composer stay below the list and the header stays reachable.
7. Enter any synthetic follow-up in the same fixture chat. During and after its local stream, scroll to older messages and repeat horizontal/vertical gestures.
8. Repeat with **mixed** and **short** fixtures. Check prose, code, composer, and normal back/title/bookmark/Trash. No router group/file fallback labels should appear.
9. If normal production AI behavior needs a smoke check, use a separate ordinary chat intentionally. It is not required for deterministic regression tests and does consume a provider request.

Record each item as PASS/FAIL on the actual phone; browser success is not a substitute. If scrolling still fails, report iPhone model, iOS/Expo Go versions, fixture kind, whether streaming or completed, and which start/end marker becomes unreachable. Do not include a real transcript or encryption key in diagnostics.

## Saved-start and explicit Save

1. From an empty Saved screen, tap **Start a temporary chat**. Check the explanatory line: **Chats stay temporary until you choose Save.**
2. Before pressing Save, verify it does not appear in Saved. Empty chats may be omitted from Active Chats until meaningful messages exist.
3. For a reproducible meaningful transcript, return to Settings and open a fixture.
4. Press the bookmark and confirm **Save on this iPhone**.
5. Open Kalillac → Saved. The new snapshot should appear there. No Apple Files picker/export is involved.
6. Open the snapshot and check its beginning, ending, and code contents.
7. Add a local fixture follow-up without Update; reopen Saved and verify that snapshot is unchanged.
8. Choose **Update saved copy**, then reopen it and check the new turn is included.

## Native storage and relaunch

Code inspection establishes the existing native design:

- AES-256-GCM through `expo-crypto`, generated AES-256 key, fresh 12-byte nonce and 16-byte tag; record ID is authenticated data.
- `expo-secure-store` holds the key separately in iOS Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- AsyncStorage stores versioned sealed records under `kalillac.saved.v1.<id>`, not a plaintext title/content index. Save sends no storage request to the backend.
- Startup decrypts those records into in-memory Saved sessions. It never restores unsaved active chats.
- The storage harness covers reinitialization, missing/wrong keys, tampering, and explicit-update semantics. Actual iPhone termination/relaunch remains a manual acceptance item.
- Browser preview uses memory-only WebCrypto records and keys, **not durable iOS-equivalent storage**.

Retest on the same phone/app installation:

1. Save one fixture and leave another meaningful fixture unsaved.
2. Fully terminate Expo Go from the iOS app switcher; reopen the same Kalillac project. Merely backgrounding is not process termination.
3. Verify the saved fixture returns in Saved and reopens correctly. Verify the unsaved chat is absent from Active Chats.
4. Do not uninstall Expo Go, clear application data, switch app identities, or move devices during this test.

## Unified delete A/B

Keep an unrelated chat as a control.

**A:** Save a meaningful fixture, open it, then Trash → Delete Conversation. Confirm Home navigation and removal from both Active Chats and Saved. The control must remain.

**B:** Save another meaningful fixture, delete it from Saved, and confirm it disappears from Saved and its linked Active Chats. The control must remain.

After native deletion, terminate/relaunch once more and verify the deleted record does not return. Delete only synthetic test chats; deletion is permanent.

## Safety-label and route findings

- No source in the current Kalillac code inserts `User Safety: safe`. Provider parsing forwards `choices[0].delta.content` (or nonstream `message.content`), not reasoning/safety fields. The client also ignores extra metadata in its protocol; an offline regression test covers that.
- The specific screenshot label's origin is **unconfirmed**. Model-generated answer text is plausible; there is no captured sanitized event establishing that. No blanket text stripping or provider/safety architecture changes were made.
- The chat title already comes from the conversation, but the native back control had no explicit fallback policy and could inherit `(tabs)`. The stack now declares a `Chat` fallback title, a minimal icon-only back control, and an explicit `Back` label to avoid leaking the previous route through accessibility. The screen continues to supply the actual conversation title/actions. The browser first confirmed the visual label was absent but found the inherited accessibility label; the explicit `Back` override was added afterward and checked against Expo Router's back-button implementation. Physical verification is still required.

## Automated/environment checks

- Mobile TypeScript: PASS. Jest: 43/43 tests, 7/7 suites (including storage/delete and Markdown-security suites).
- iOS Metro/Hermes JavaScript export to `/tmp`: PASS (compile-only, not simulator/device execution).
- Browser: long-code/mixed vertical traversal reached both ends and earlier user markers, without a large unrelated gap; short prose fit normally. Header/composer stayed positioned. Local streaming, Save/reopen, chat-header deletion, and empty-Saved temporary-start checks passed. Chat API requests were intercepted/blocked; zero attempts occurred.
- Browser horizontal gestures: **NOT VERIFIED**. Code had a horizontal overflow range and programmatic horizontal movement worked independently of vertical travel, but automated wheel/Shift-wheel/drag attempts did not move it. This does not establish iOS touch behavior or a browser gesture pass. Retest actual horizontal input and native finger gestures.
- Browser unrelated-control preservation: NOT COMPLETED; another screen's overlapping subtree intercepted the attempted navigation. No control chat was deleted during that attempt. Saved-list deletion and unrelated-control preservation still require the manual A/B checklist; automated repository tests cover their state semantics.
- No iOS simulator or physical-iPhone tests were run.
- Expo dependency check: FAIL on six existing SDK-57 patch mismatches. Doctor: 20/21 checks passed, with the same dependency-version failure. Packages: Expo 57.0.24 → expected ~57.0.31; Constants 57.0.19 → ~57.0.22; Crypto 57.0.3 → ~57.0.4; Linking 57.0.10 → ~57.0.13; Router 57.0.22 → ~57.0.29; Splash Screen 57.0.9 → ~57.0.10. No dependency upgrades, exclusions, provider/backend changes, or storage architecture changes were made for this targeted fix.

## Product/test files changed

All paths below are relative to `artifacts/kalillac-mobile/`:

- `app/(app)/chat/[id].tsx` — shared code wrapper, explicit list/width behavior, development-only local transport selection.
- `components/MarkdownCodeBlock.tsx` — intrinsic-height horizontal code viewport.
- `app/(app)/_layout.tsx` — native chat title/back fallback.
- `app/(app)/(tabs)/saved.tsx` — temporary-chat wording only.
- `app/(app)/(tabs)/settings.tsx` — development-only fixture launch controls.
- `dev/chatFixtures.ts` — deterministic synthetic prose/code and cancellable local streaming.
- `__tests__/chat-code-layout.test.ts` — parser, complete text, component contract, local stream, cancellation, wording/router checks.
- `__tests__/backend-stream-service.test.ts` — synthetic metadata isolation regression.

This report is `docs/IPHONE_CHAT_SCROLL_RETEST.md` at the workspace root. No commit or push was performed.

**Physical-iPhone scrolling and Saved-storage acceptance: PENDING user retest.**
