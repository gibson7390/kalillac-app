---
name: React Native Markdown dependencies
description: Metro and Expo Doctor constraints for the native Markdown renderer dependency path.
---

Use a maintained native renderer whose resolved parser runtime has no Node-core imports. `markdown-it` releases that still contain `require('punycode')` can pass static package metadata checks but fail only when Metro bundles iOS; verify the actual platform bundle and runtime entrypoint. Newer renderer releases may also bring scoped icon packages, which can require migrating existing icon imports so Expo Doctor does not report conflicting icon libraries.

**Why:** Metro rejects Node standard-library imports in native bundles, and Expo Doctor flags mixed icon package families even when the UI is unchanged.

**How to apply:** When changing Markdown dependencies in this workspace, inspect the resolved parser entrypoint, run the iOS Metro bundle, run Expo Doctor, and preserve the existing renderer rules and link/image/HTML security behavior.