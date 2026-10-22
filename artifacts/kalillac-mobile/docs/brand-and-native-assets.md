# Kalillac brand and native asset audit

## Existing sources, preserved unchanged

| Path (relative to this app) | Actual format | Dimensions | Bytes | Notes |
| --- | --- | --- | ---: | --- |
| `assets/brand/kalillac-mark.png` | JPEG, despite extension | 1254 × 1254 | 24,865 | Opaque black matte; approved navy K and blue dot. |
| `assets/brand/kalillac-wordmark.png` | JPEG, despite extension | 1600 × 533 | 21,688 | Opaque black matte; not suitable as a transparent in-app lockup. |
| `assets/images/icon.png` | RGB PNG | 1024 × 1024 | 393,493 | Generic Expo artwork, retained for provenance, no longer configured. |

No existing SVG/vector master, transparent brand source, Android adaptive foreground, dedicated splash asset, or separate favicon was found. Audit screenshots are not brand masters.

## Derived assets, not a new logo

The existing mark was decoded with the already-installed image tools. Only edge-connected near-black matte pixels (all RGB channels ≤ 8) were made transparent. The remaining source RGB values were not recolored. The resulting bounds were 608 × 556, starting at source pixel (352, 340). Originals were not overwritten. JPEG antialiasing/compression cannot be recovered as vector-quality artwork.

| Added path under `assets/brand/` | Actual format | Dimensions | Bytes | Purpose |
| --- | --- | --- | ---: | --- |
| `kalillac-mark-ui.png` | RGBA PNG | 192 × 192 | 13,998 | Downsampled UI derivative; no black rectangle. |
| `icon-placeholder.png` | RGB PNG, opaque | 1024 × 1024 | 52,614 | Preliminary native composition, not a final App Store master. |
| `icon-foreground-placeholder.png` | RGBA PNG | 1024 × 1024 | 57,059 | Preliminary adaptive foreground. |
| `favicon-placeholder.png` | RGB PNG | 48 × 48 | 1,479 | Small web-only derivative. |

The icon places the native-resolution 608 × 556 mark at (208, 234) on a 1024 square. No upscaling, wordmark, corner mask, animation, or unnecessary text is applied. The opaque background is the existing light app background, `#F7F8F9`. The adaptive foreground uses the same placement with transparency. The UI asset is downsampled, not enlarged into a production icon.

### Production asset still required

Obtain an approved clean transparent/vector K + blue-dot master. Use it to finish and approve a 1024 × 1024 opaque, color-managed default icon and the appropriate appearance assets or Icon Composer layers. Inspect small-size legibility and system masks on real devices. The current files are intentionally named placeholders because a lossy JPEG extraction is not final production artwork.

## Native configuration and appearances

Before this change, `app.json` used the generic icon at the root and as its web favicon. There were no iOS icon overrides, adaptive icon fields, or splash plugin settings. No `app.config.*` file exists.

Now the root and iOS icon use the preliminary 1024 composition; Android uses its transparent adaptive foreground with the matching background. Web uses the small favicon. No new dependency or Expo upgrade is needed.

The installed Expo config types support `ios.icon` as a PNG path, an object with `light`, `dark`, and `tinted` paths, or a path to an Icon Composer `.icon` directory. There is no separate `clear` PNG field in `IOSIcons`. Expo's official guide supports `.icon` directories from SDK 54 onward.

Only the default preliminary icon is configured now. Distinct default/dark/clear/tinted appearance approval is deferred until the clean master and a production iOS build are available. Use Icon Composer/Xcode's current appearance workflow for clear/material treatments, retaining the same K and dot identity. Do not fabricate unsupported config fields, native patches, or misleading appearance variants.

Reference: https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/

Apple's current Icon Composer overview: https://developer.apple.com/icon-composer/

## Launch screen

The installed `expo-splash-screen` plugin is configured with background-only light `#F7F8F9` and dark `#0B0D12` colors, matching the application's existing initial surfaces. No new splash image, text, marketing page, timer, animation, or delay is added. Existing font/preferences readiness and `hideAsync()` behavior are unchanged.

The native launch screen follows system appearance; a manually overridden in-app theme can differ until preferences load. Android's system-managed launch icon may also appear. Neither appearance is accepted merely from Expo Go.

Expo's guide warns that Expo Go and development-client splash screens can differ from standalone behavior. Verify the final launch transition in an internal standalone/preview or release build, and the actual App Store icon/appearances on a real device.

## Syntax highlighting: analysis only

Current renderer: `components/MarkdownCodeBlock.tsx`, called by the code rules in `app/(app)/chat/[id].tsx`. It displays plain monospace content in `ThemedText` inside the existing horizontally scrolling code layout. Fenced language identifiers are not tokenized or highlighted.

The eventual integration point is the textual code content, not the Markdown parser, stream protocol, or outer sizing/scrolling shell. A small React Native-safe lexical tokenizer would likely be required for broad language support; no such dependency is added or selected here. Do not introduce a DOM highlighter, WebView, Node-core dependency, or HTML injection.

Nested colored text spans change the native text subtree and may affect selection, wrapping, glyph measurement, render churn, scrolling, and the prior gray-block behavior. Tokenizing every streaming delta can add CPU/memory overhead and reconciliation instability. Production work needs bounded input/token counts, plain-text fallback, careful memoization, streaming/finalization tests, and malicious/large-code cases.

Wait for a real development-build acceptance gate: long unbroken lines, mixed Markdown, repeated regeneration/Stop, horizontal and vertical scrolling, selection, large Dynamic Type, dark/light contrast, memory, and the known Candidate B native behaviors must be checked on iPhone. No renderer or syntax-highlighting implementation is changed in this milestone.

## Performance evidence and limits

- The one new in-app image is 192×192, 13,998 bytes compressed (about 144 KiB decoded RGBA). It appears only on the three chosen brand surfaces, not within the chat list.
- The four new PNG files total 125,150 bytes. The native/adaptive icon files are build-time resources, not recurring chat decorations.
- No runtime dependency, font family, animation library, SVG parser, blur layer, startup timer, or decorative chat state was introduced.
- Current successful exports: iOS Hermes bundle 4,884,465 bytes; web JavaScript bundle 3,149,863 bytes. These are output measurements, not native startup/memory/scroll benchmarks.
- Startup readiness logic, stream code, and code-block rendering are unchanged. Native performance is not certified by source inspection or web fixtures.

## Exact iPhone retest handoff — not yet performed

1. Install a newly built standalone internal-preview/release candidate from this branch; an old installed binary will not contain the new icon/splash configuration. Do not use Expo Go or the development client as native-launch acceptance evidence.
2. Inspect the Home Screen icon in default, dark, clear, and tinted appearances supported by that iOS version. The present default PNG is preliminary; distinct production appearance assets are not configured or approved. Record visible clipping, contrast, matte/fringe, or scaling problems.
3. Force-quit, then cold-launch in system Light and Dark. Check the plain matching background, transition to usable UI, and absence of an artificial branding pause. Also check a saved in-app theme that differs from the system theme; a system-native launch screen cannot read the in-app preference before launch.
4. In both app themes inspect Home, first-use/review, Settings and Privacy. Turn on larger Accessibility Text and VoiceOver; check readable wrapping, button labels/states, privacy links, and consent actions. Declining must not send; allowing must still require an explicit Send.
5. Open Developer/demo controls and the existing local mixed/long-code transcript. Without sending or regenerating, check long vertical/horizontal scrolling, Latest, composer/keyboard, actions/Edit/Cancel, and Save/reopen. Force-quit and reopen Saved to test real native persistence. Do not log transcript text, encryption keys, or other sensitive values.

Native icon, launch, VoiceOver/Dynamic Type, keyboard/scroll, and physical Save acceptance remain unverified until those real-device observations exist.

## Completed verification evidence

- Source inspection/AST comparisons: protected message actions, stream/Stop/regeneration handlers, consent decision handlers, Markdown JSX/rules, Save and diagnostics are unchanged against the accepted starting commit. The native code-block component, repository/preferences, transport/consent modules, and startup layout are byte-identical.
- Automated checks: 151 mobile tests across 16 suites; 208 backend tests; TypeScript; Python compile/build; iOS Metro/Hermes export; web export. Expo Doctor remains 20/21 with the six known patch mismatches, without upgrades.
- Settled browser views: Home light/dark, first-use/review, empty/active/long chat, actions, edit/cancel, Sources, partial/error/Retry, responding/Stop, Saved empty/populated/reopened, Settings, Privacy and provider disclosure, at 402px and selected 375px states.
- The browser intercepted five synthetic stream POSTs and forwarded none. Declined Send made zero POSTs; allowing permission did not auto-send. Copy, Regenerate, Retry, Stop suppression of a late fixture, and local Save/reopen worked. No real OpenRouter or Tavily calls were made.
- Narrow consent clarification: the final paragraph was initially below the viewport, not blocked by actions. At maximum scroll, `scrollTop=142`, `clientHeight=678`, `scrollHeight=820`; the final notice ended at y=670, above the Done control beginning at y=702.
- A cold static screenshot was blank; the browser tour observed an approximately 1.2-second initial settle and used loaded views. This is not a measured native-startup regression or acceptance.
- The existing React Native DevTools installer reports missing `libglib-2.0.so.0`; Metro and the app served normally. Web shadow/pointer-events deprecation warnings remain. No toolchain or renderer change was made to silence them.
- No iOS simulator, installed native binary, physical iPhone, native launch/icon, VoiceOver, large Dynamic Type, or encrypted device-persistence acceptance was performed.
