# iPhone diagnosis: streamed code and encrypted Save

## Evidence boundary and current diagnosis

- **Physical-iPhone report:** the long code area still goes blank after growing; Expo Go exited after confirming “Save on this iPhone.” Both are treated as reproduced by the user, not as fixed.
- **Local code inspection:** the backend stream appends each delta to one cumulative string and sends that full string on every update. The screen replaces the message content with that same full cumulative value; its completion callback also sends the complete accumulated value. There is no output-length cap or truncation in this path. This is evidence against an obvious provider/finalization truncation, but it does **not** prove which state was present at the instant the phone displayed a blank block.
- **Current available Expo/Metro logs:** they include ordinary stream activity and two Saved-store startup enumeration events, but **no Save-stage event or native crash/error**. They do not establish the last Save stage, the exact native failure, or whether the phone had the newest JavaScript bundle.
- **Root causes:** still unconfirmed for both physical failures. No Markdown rendering strategy was changed in this pass. The new device diagnostics are intended to distinguish preserved message state from a render/layout/unmount problem and identify the last Save stage.
- **Device evidence:** no simulator or physical iPhone is accessible from this workspace. Do not treat an iOS export, Jest, or browser preview as native acceptance.

## Long-code diagnostics

The diagnostics are development-only and content-free. `[kalillac-assistant]` entries record the opaque assistant message ID, accumulated character count, delta number, stream state, fence count, whether the render-only copy is balanced, rendered code-block count, message/code-block mount and unmount, stable message key observations, and measured message/code viewport dimensions. They never contain response text.

`KalillacChatService` and the screen still pass and store the complete cumulative response. Existing render-only unmatched-fence balancing and the previous native scrolling changes remain in place. No new renderer workaround, syntax highlighting, output truncation, or provider change was added.

Interpret the next reproduction as follows:

- If `message-render-committed` still reports the long character count and expected rendered code-block count while the phone shows blank, the content reached React state and the failure is downstream in Markdown/native rendering or layout. Check the adjacent `code-block-layout`, mount/unmount, key, and height events.
- If the state-update event reports the full count but a later `message-render-committed` count drops or vanishes, inspect state replacement/finalization.
- If `message-unmounted` appears at disappearance, virtualization/navigation/reuse is implicated; include the matching message key and preceding layout records.
- If the saved text remains full through `finalized` or `stopped`, finalization/stop did not truncate the received response.

These are discriminating observations, not a claim that any particular renderer or native layout root cause has already been proven.

## Expo Go support for the current encryption path

Current project packages and APIs:

- `expo-crypto` `57.0.3`: `AESEncryptionKey.generate(AESKeySize.AES256)`, `AESEncryptionKey.import(..., 'base64')`, `aesEncryptAsync`, `aesDecryptAsync`, `AESSealedData.fromCombined`, and `.combined('base64')`.
- Encryption uses the Expo Crypto AES-GCM API with a 12-byte generated nonce, a 16-byte authentication tag, and the snapshot ID as additional authenticated data. The SDK 57 API docs specify AES-GCM; the iOS package implementation generates the nonce when passed its requested byte length.
- `expo-secure-store` `57.0.4`: `getItemAsync` / `setItemAsync`, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, for the base64 key.
- `@react-native-async-storage/async-storage` `2.2.0`: encrypted record read/write/list/remove operations. Its record value is ciphertext, not plaintext.
- `buffer` `6.0.3`: JavaScript byte/UTF-8/base64 conversions; no native module is required for Buffer.

Expo's SDK 57 docs mark `expo-crypto`, `expo-secure-store`, and AsyncStorage as included in Expo Go. Thus **Expo Go is a valid environment for testing these modules**; the inspected encryption path does not itself require a custom development build. That does not establish that the specific Save flow cannot hit a runtime or native crash. Available logs contain no stage/error evidence to diagnose one. A custom development build is **not currently indicated** by a missing-module incompatibility.

Reference docs: [Expo Crypto SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/crypto.md), [SecureStore SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore.md), and [AsyncStorage SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/async-storage.md).

## Save diagnostics and behavior

Development-only `[Kalillac Saved]` entries now report `save_confirmed`, key load, key creation (if required), encryption, write, read-back verification, repository commit, rollback, and `save_success`. Entries contain opaque IDs, stage, started/success/failure, and an error class only. They never log conversation content, plaintext snapshots, ciphertext, keys, SecureStore contents, credentials, or error messages.

If Expo Go exits again, the last `started`/`success` event is the last stage the JavaScript runtime recorded. A `*_failed` event includes only the error class. If it exits with only a `*_started` event and no failure event, share just the matching labeled entries; this indicates termination before JavaScript recorded completion, not which native cause occurred.

Persistence is still encrypted-only. Save success is reported only after verified encrypted read-back and repository commit. A failed initial repository commit removes the newly written snapshot; a failed explicit update restores its prior encrypted record. Initial Save remains explicit, later turns remain temporary, and replacement still requires **Update saved copy**. Delete and Clear Temporary Chats behavior were not otherwise changed.

## Exact physical-iPhone retest

### Confirm the current candidate

1. In Replit, restart the existing `artifacts/kalillac-mobile: expo` workflow after this change is deployed to the preview.
2. Force-quit Expo Go using the iPhone app switcher.
3. Open Replit’s **Preview on your phone** panel and scan/open the current project QR code.
4. In the Chat screen, confirm the visible development-only label is exactly **`iOS candidate: native-diag-2026-10-21-a`**. If it is absent or differs, do not run the regression; close Expo Go, scan the current QR again, and use Expo Go’s **Reload** command.

### Reproduce long code without a provider call

1. Open **Settings → Developer Tools → Local fixture: long-code (no provider)**.
2. Send the harmless fixture prompt and let the synthetic response stream. Do not use real conversation content for this test.
3. If the code turns into a blank gray area, leave the screen open long enough for the latest diagnostics to arrive, then note the assistant message ID shown in `[kalillac-assistant]`.
4. If it does not recur, let the response finish, then repeat once and press Stop during the long response.
5. Check that short code, prose, horizontal code scrolling, and the improved vertical chat scrolling remain usable.
6. Share only `[kalillac-assistant]` lines for that message ID, including the last `message-state-update-requested`, `message-render-committed`, layout, mount/unmount, and key events. Do not share response text.

### Reproduce Save and identify the last stage

1. Create a normal meaningful temporary chat and confirm it is absent from Saved.
2. Press bookmark, confirm **Save this chat** and **Save on this iPhone**, then choose **Save on this iPhone**.
3. If Expo Go exits, reopen the same project by its QR code and check whether the Saved entry exists.
4. In the Replit Expo workflow output, locate only `[Kalillac Saved]` lines whose `operationId` matches the temporary chat’s opaque ID. Record the last stage/status and any `errorClass`.
5. If it succeeds, confirm one Saved entry appears, later turns do not change it, and **Update saved copy** is still explicit.
6. If Expo Go exits without any Save trace, confirm the candidate marker again and report that fact; do not infer an AES, Keychain, or AsyncStorage error from the exit alone.

## Validation performed in this workspace

- TypeScript: PASS.
- Full Jest: **52 tests / 7 suites passed**, provider-free. Includes long incremental accumulation, exact render-copy length, finalization and stopped content preservation, encryption/storage, key/encrypt/write/read-back failure, repository-commit rollback, and Markdown/security tests.
- iOS Metro/Hermes export: PASS, 1,847 modules, compile-only; the produced Hermes bundle was 4.8 MB.
- Web export: PASS, 1,538 modules; bundle was 3.1 MB. The first browser screenshot was captured on a white loading frame; a delayed retake showed the onboarding screen. The changed Chat/Save interactions were not exercised in browser, so their visual regression is not counted as passed.
- Expo Doctor: **20/21** checks passed. The remaining dependency check reports existing patch mismatches: Expo 57.0.24 vs ~57.0.31, Constants 57.0.19 vs ~57.0.22, Crypto 57.0.3 vs ~57.0.4, Linking 57.0.10 vs ~57.0.13, Router 57.0.22 vs ~57.0.29, and Splash Screen 57.0.9 vs ~57.0.10. No packages were upgraded.
- Physical iPhone and simulator: not available to the agent; acceptance is pending the retest above.
- The Expo workflow was restarted and Metro/Web bundling completed. This confirms the candidate is served by the restarted workflow, **not** that the phone has loaded it; verify the visible candidate ID on the iPhone.

## Files changed

Relative to `artifacts/kalillac-mobile/`:

- `app/(app)/chat/[id].tsx`
- `components/MarkdownCodeBlock.tsx`
- `contexts/ChatRepositoryContext.tsx`
- `services/savedChatStore.ts`
- `services/savedSnapshotTransaction.ts` (new)
- `utils/streamingMarkdown.ts`
- `utils/assistantRenderDiagnostics.ts` (new)
- `dev/nativeCandidate.ts` (new)
- `__tests__/chat-code-layout.test.ts`
- `__tests__/saved-chat-store.test.ts`

This report is at `docs/IPHONE_NATIVE_RETEST_TWO_ISSUES.md`. No commit or push was performed.
