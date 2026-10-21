# Physical-iPhone diagnostic candidate B

Candidate: `native-diag-2026-10-21-b` (development/testing UI only).

## Status and evidence limits

The user physically confirmed candidate A's marker and all four reported symptoms. That is accepted as physical-device evidence; stale code is not an explanation for those observations.

This workspace's log snapshot after that report contained web console activity, not the iPhone's assistant or Save-stage events. The older assistant events available in temporary log files were browser events. Absence of a native event here does **not** prove a tap or Save operation did not execute.

No simulator or physical iPhone was available to the agent. Candidate B is a corrective/diagnostic candidate, not physical acceptance.

## 1–3. Long-code state versus native rendering and root cause

**Physical distinction: not established. Exact native root cause: not established.**

Code inspection: the transport accumulates the full response; screen updates write that cumulative string; stop changes request flags without clearing content. Automated fixtures preserve every accumulated delta, final response, stopped response, and large/incomplete render copy. This is not evidence of what remained in repository state at the moment the iPhone's block became blank.

The existing renderer, code ScrollView, FlatList virtualization settings, stable keys, and scroll ownership are unchanged. No speculative Markdown workaround, clipping limit, output reduction, or syntax highlighting was added.

The long-code local fixture now has 1,000 HTML lines, 1,000 Python lines, and 1,000 JavaScript lines, delivered incrementally with no provider calls. Mixed/short fixtures remain available.

The development-only Chat action **Capture & copy native diagnostics** now records committed repository character counts at the moment it is pressed and exports the latest per-message render/layout checkpoints. This bypasses the missing console-forwarding problem:

- `repository-state-captured` versus `message-state-update-requested` and `message-render-committed` distinguishes repository loss from presentation loss.
- Full repository counts plus a shortened render copy identify presentation normalization/parser input differences.
- Full repository/render-copy counts plus code-block count/layout/mount/key records narrow native layout, parsing, and lifecycle hypotheses.
- A large measured height alone does not prove the exact native drawing defect.

`renderCopyBalancingApplied` now explicitly records whether an unmatched fence was closed in the display copy. Source text is not changed.

## 4. Regenerate/Retry

Proven code defects corrected:

- Every circular button invoked a global handler that selected the latest user prompt, not the tapped assistant's source turn.
- It built backend context from the old conversation including the superseded answer and could append the prompt again.
- It deleted answer/branch messages instead of replacing only the target.
- The screen's completed transport reference was not reliably cleared, because its old cleanup condition depended on an active message ID already cleared at completion.
- A reused transport's older finalizer could clear a newer cancellation controller.

The shared Retry/Regenerate path now resolves the tapped assistant and preceding user, ends request context at that user, replaces the assistant in place, preserves all user/later messages, resets cancellation before activation, and retains generation-based late-delta protection. In-flight controls are disabled; Stop remains separate.

Native-only non-start cause is **not proven**: no physical touch/handler/transport trace was available. The corrected defects are not presented as proof that the iPhone problem is resolved.

Development-only events include `regenerate_touch_started`, `regenerate_pressed`, `regenerate_target_resolved`, `regenerate_request_started`, `regenerate_transport_started`, `regenerate_backend_request_started`, `regenerate_first_delta`, `regenerate_completed`, and `regenerate_failed` with error class only.

## 5–7. Save stage, crash evidence, Expo Go

**Last stage from the reported iPhone exit: unavailable. Native crash/error evidence: unavailable.**

The staged console events were not received in the accessible logs.

The browser regression subsequently reproduced a concrete shared Save defect: `TypeError: ...snapshotForStorage is not a function` in `ChatRepositoryProvider`. The failure occurs in the effect that checks saved repository state and resolves pending commit waiters, after persistence/read-back has returned and the saved state is being committed.

Cause: the repository imported `snapshotForStorage` from extensionless `savedChatStore`. Metro selects the `.web.ts` / `.native.ts` adapter for that basename; those adapters export `savedChatStore`, not `snapshotForStorage`. TypeScript/default Jest resolution selected the shared file instead, so the earlier checks missed the runtime mismatch.

Correction: import the shared helper from explicit `savedChatStore.ts`, consistent with the adapters' own imports. A module-resolution contract regression was added.

This is a proven platform-import defect with an observed browser repository-commit failure. The same incorrect native import path is present in the inspected source, making it a supported explanation for native Save failure. It is **not** a captured iPhone crash stack or proof that this explains Expo Go closing. The device's actual last stage still needs the candidate-B retest. There is no evidence here of an AES/CryptoKit, Keychain, or AsyncStorage crash.

The AES-256-GCM implementation and libraries are unchanged:

- `expo-crypto` 57.0.3
- `expo-secure-store` 57.0.4
- `@react-native-async-storage/async-storage` 2.2.0
- `buffer` 6.0.3

The documented SDK 57 native modules are included in Expo Go; no missing-module explanation or custom-build requirement was established. Expo Go remains a valid test environment for this path. Existing SDK patch mismatches remain a separate caveat.

The new development-only ledger stores only allowlisted IDs, stages/statuses/error classes, counts, and layout metrics in a separate diagnostics key. It keeps 240 recent events and up to 80 latest checkpoints. Save's critical checkpoints are awaited before the next native operation. After a process exit, Settings can copy the last durable trace.

Additional checkpoints distinguish reading the existing encrypted record, key generation, and key storage. This does not provide a native crash stack, and an exit during the diagnostics write itself can leave an earlier checkpoint. Diagnostic write failures must not change actual Save semantics.

Existing verified read-back, repository-commit ordering, JavaScript failure rollback, no-plaintext fallback, initial Save linkage, and explicit Update behavior remain intact. A process termination cannot execute JavaScript catch/rollback; no claim of process-death recovery or native crash resolution is made.

The Linux React Native DevTools helper still reports a missing `libglib-2.0.so.0`. Metro starts and serves successfully. That startup warning is not an iPhone Save crash record.

## 8. Safety labels

The inspected live response path used OpenRouter `choices[0].message.content` / `choices[0].delta.content` verbatim. There was no app formatter or fixture constructing these labels; structured reasoning/debug/safety fields were already excluded. This proves an unfiltered provider-content exposure path, not which routed upstream model emitted the specific physical response.

The provider boundary now separates standalone `User Safety: safe/unsafe` and `Response Safety: safe/unsafe` classification lines from customer text, including labels split across streaming deltas. Classifications are retained in internal `safety_metadata`; the API's customer-text fields never concatenate that metadata. The system instruction asks for customer-facing formatting without changing safety policy or refusal handling.

A presentation-only compatibility filter hides the same standalone labels in older answers and their Copy/Share output, without rewriting repository/snapshot text. Literal labels inside fenced or indented code are preserved. Ordinary prose, refusals, and complete/incomplete long code remain intact.

## 9. Exact files changed

Backend:

- `artifacts/api-server/provider.py`
- `artifacts/api-server/response_text.py` (new)
- `artifacts/api-server/test_response_text.py` (new)
- `artifacts/api-server/package.json` (compile the new Python module; no dependency change)

Mobile runtime:

- `artifacts/kalillac-mobile/app/(app)/chat/[id].tsx`
- `artifacts/kalillac-mobile/app/(app)/(tabs)/settings.tsx`
- `artifacts/kalillac-mobile/contexts/ChatRepositoryContext.tsx`
- `artifacts/kalillac-mobile/dev/chatFixtures.ts`
- `artifacts/kalillac-mobile/dev/nativeCandidate.ts`
- `artifacts/kalillac-mobile/dev/nativeDiagnostics.ts` (new)
- `artifacts/kalillac-mobile/services/KalillacChatService.ts`
- `artifacts/kalillac-mobile/services/savedChatStore.native.ts`
- `artifacts/kalillac-mobile/services/savedChatStore.ts`
- `artifacts/kalillac-mobile/services/savedSnapshotTransaction.ts`
- `artifacts/kalillac-mobile/utils/assistantRenderDiagnostics.ts`
- `artifacts/kalillac-mobile/utils/streamingMarkdown.ts`
- `artifacts/kalillac-mobile/utils/customerVisibleText.ts` (new)
- `artifacts/kalillac-mobile/utils/regeneration.ts` (new)

Mobile tests:

- `artifacts/kalillac-mobile/__tests__/backend-stream-service.test.ts`
- `artifacts/kalillac-mobile/__tests__/chat-code-layout.test.ts`
- `artifacts/kalillac-mobile/__tests__/saved-chat-store.test.ts`
- `artifacts/kalillac-mobile/__tests__/native-diagnostics.test.ts` (new)
- `artifacts/kalillac-mobile/__tests__/regeneration.test.ts` (new)
- `artifacts/kalillac-mobile/__tests__/snapshot-module-resolution.test.ts` (new)
- `artifacts/kalillac-mobile/tests/customer-visible-text.test.ts` (new)

Documentation:

- `docs/IPHONE_NATIVE_CANDIDATE_B.md` (this report)
- `.agents/memory/native-acceptance.md` (diagnostic evidence limitation, not an implementation log)

## 10–11. Tests and validation

All automated content is synthetic; HTTP provider tests use `httpx.MockTransport`, and mobile transports are mocked/local. Zero live provider requests are required.

- TypeScript/typecheck: PASS.
- Full Jest: **64 tests / 11 suites PASS**, including repository-state, streaming, Markdown/security, snapshots, and encrypted-storage suites.
- Backend pytest: **23 tests PASS**. Combined automated total: **87 passing tests**.
- Backend Python compilation: PASS.
- New/extended coverage: tapped-target source context; action/cancellation ordering and repeated regeneration; fresh transport signals and stale-finalizer protection; very large code and literal-label preservation; split/bold provider-content classifications and internal structured metadata; durable pre-encryption checkpoint ordering; bounded, restored, content-free diagnostics and disabled release diagnostics; explicit shared snapshot-helper import. Existing encryption/persistence/read-back/repository-failure/rollback/no-false-success tests pass.
- iOS Metro/Hermes export: PASS, 1,850 modules, 4.8 MB Hermes bundle. This is compile/export evidence only.
- Web export: PASS, 1,541 modules, 3.1 MB bundle.
- Browser startup screenshot: onboarding rendered.
- Browser fixture interaction regression: first pass verified two short regenerations with stable assistant/source IDs, no duplicated user, mixed code completion with all three blocks and ending marker, and **zero chat API requests**. It exposed the Save import error above. The focused recheck after the fix passed: Save kept the chat healthy and produced one linked 2-message snapshot; a synthetic fixture continuation produced 4 active messages while Saved remained at 2; explicit Update changed that same one snapshot to 4 messages.
- Browser long-code Stop: PASS for retained/stable partial output. Full fixture length was 548,629 characters; Stop retained approximately 311,296 received characters midway through Python, without the fixture end marker, and the displayed body remained unchanged after 500 ms. The visible Stop control worked; its expected accessible-role/name locator did not resolve, so the tester used the visible control. No physical-iOS inference is made. Vertical/horizontal scrolling were not interactively verified in this browser pass.
- Both browser passes kept chat API routes blocked and recorded **zero chat API attempts**. No live provider was used.
- Existing API workflow health check: `{"status":"ok"}`. API and Expo workflows restarted.
- Expo Doctor: **20/21 checks PASS**; the remaining check reports the same six patch mismatches below. No SDK/package upgrade was performed.
- Jest retains the existing `ts-jest` isolatedModules deprecation warning.

| Package | Installed | Expected |
| --- | --- | --- |
| expo | 57.0.24 | ~57.0.31 |
| expo-constants | 57.0.19 | ~57.0.22 |
| expo-crypto | 57.0.3 | ~57.0.4 |
| expo-linking | 57.0.10 | ~57.0.13 |
| expo-router | 57.0.22 | ~57.0.29 |
| expo-splash-screen | 57.0.9 | ~57.0.10 |

## 12. Marker

The development-only Chat marker is:

`iOS candidate: native-diag-2026-10-21-b`

It and the diagnostics controls are behind `__DEV__`. The recorder is disabled in release mode; production/TestFlight release UI does not display the marker.

## 13. Exact physical-iPhone retest

### Load the candidate

1. Force-quit Expo Go via the iPhone app switcher.
2. Open Replit's current **Preview on your phone** QR and scan it.
3. Open Chat and verify `iOS candidate: native-diag-2026-10-21-b`. Do not test a different marker.
4. Settings → Developer Tools → **Clear native diagnostics only**. This does not clear chats, saved copies, or encryption keys.

### Long code, Stop, and Regenerate (no provider)

1. Settings → Developer Tools → **Local fixture: long-code (no provider)**.
2. Inspect the completed HTML/Python/JavaScript blocks and travel vertically and horizontally.
3. Press the circular Regenerate button. Watch the incremental output; Stop partway through and confirm the received code remains.
4. Regenerate again and allow completion. Confirm the beginning/end code and `FIXTURE END` remain reachable; repeat twice.
5. At the instant a block is blank—or after the last successful result—press **Capture & copy native diagnostics** below the candidate marker. This captures current repository counts while preserving the conversation.
6. Paste that content-free trace with a short note identifying whether you captured it while blank, streaming, stopped, or completed. Do not paste the transcript.
7. For multi-turn targeting, add a synthetic follow-up inside the fixture chat, regenerate the earlier assistant, and confirm the original user and later turns remain; no extra user turn should appear.
8. To check Retry UI, use the existing simulated API-failure setting inside a fixture chat, regenerate, turn the simulation off, then Retry the failed answer. Do not use a non-fixture chat for this regression.

### Save

1. Use a short local fixture or a meaningful temporary chat. Press bookmark → **Save on this iPhone**.
2. If Expo Go exits, reopen the same project, then Settings → Developer Tools → **Copy native diagnostics (no chat content)**. Do this **before clearing diagnostics or retrying Save**.
3. Paste that trace. Its last saved-operation checkpoints show the last durable started/completed stage; do not infer a native error class if none exists.
4. If Save succeeds, check exactly one linked entry in Saved. Later turns must leave it unchanged until explicit **Update saved copy**, which must retain one entry.
5. Confirm Delete and Clear Temporary Chats still have their prior separate scopes.

### Safety labels

Inspect the previously reproducing answer if retained, and a new answer using the previously reproducing prompt. Standalone safety classifications must not appear in the body or Copy/Share output. Do not send the transcript to the agent. Backend mocked-stream and mobile compatibility tests already verify the exact labels without live provider calls; manual new-answer testing is separate evidence.

## 14. Remaining acceptance blockers

- No physical candidate-B trace or device access; A-versus-B long-code distinction and actual native drawing cause remain unknown.
- The Save platform-import defect is corrected, but no durable stage/crash evidence from the prior iPhone exit establishes that it was the cause of the process closing.
- Regenerate's proven code defects are corrected, but its native tap/transport path is not accepted until retested.
- Safety normalization is automated-test verified, not physically verified.
- Physical vertical/horizontal travel, stopped/finished code visibility, Saved persistence after reopening Expo Go, and native repeated regeneration still require the candidate-B retest.

No commit or push. No syntax highlighting, SDK upgrade, or next milestone.
