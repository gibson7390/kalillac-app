---
name: Expo validation commands
description: The Expo SDK CLI and Expo Doctor are separate validation entry points in this workspace.
---

Use `npx expo-doctor` for Expo Doctor validation. The local Expo CLI's `expo doctor` command reports that Doctor is not supported locally, while the standalone check runs successfully.

**Why:** Running the local subcommand can look like a project failure even though the supported standalone Doctor check is available.

**How to apply:** When validating the mobile artifact, run dependency alignment with the local Expo CLI, then use `npx expo-doctor` separately.