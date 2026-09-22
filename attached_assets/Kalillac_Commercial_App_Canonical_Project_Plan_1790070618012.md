# KALILLAC COMMERCIAL APP — CANONICAL PROJECT PLAN
Version 1.0 — September 22, 2026
Status: ACTIVE SOURCE OF TRUTH

## AI HANDOFF DIRECTIVE
If this file is uploaded in a future conversation, treat it as the canonical plan unless the user explicitly changes a decision. Do not redesign the product from scratch. Resume from the next unfinished milestone. Do not alter the existing live Kalillac web product.

## 1. GOAL
Build and monetize a serious consumer AI mobile app under the Kalillac brand.

Primary positioning:
**Private by default. Save only what you choose.**

Commercial promise:
**Powerful AI without automatically turning every conversation into a permanent record.**

Kalillac must feel like a premium consumer app, not a prototype or generic chatbot wrapper.

## 2. CORE PRODUCT
Default mode: **Auto**

Manual modes:
- Fast
- Smart
- Deep

Core capabilities:
- general chat
- web search/research with citations
- files/PDFs/images
- coding/debugging
- study/tutoring
- long conversations
- excellent Markdown, code blocks and tables
- copy/share/edit/regenerate/stop
- polished onboarding
- dark/light mode
- premium typography
- fluid streaming
- subtle animations
- haptics
- accessibility
- temporary chats
- optional saved chats
- privacy/provider details
- paid subscription
- no ads in paid service

Deferred until after v1 unless explicitly reprioritized:
- voice
- image generation
- Android
- web app
- cloud chat sync
- long-term memory
- custom agents
- teams/enterprise

## 3. MODEL PLAN
Fast:
- Groq gpt-oss-120b
- Groq Zero Data Retention enabled before production traffic

Smart:
- OpenAI GPT-5.6 Luna
- store=false for temporary chats

Deep:
- OpenAI GPT-5.6 Terra
- store=false for temporary chats

Auto:
- routes based on task difficulty, privacy, cost, need for current info, files/images and context length

Do not route everything to Terra.
Prefer deterministic/local processing whenever practical.

## 4. PRIVACY ARCHITECTURE
Temporary chat is the default.

Unsaved chat content may exist only in:
- device memory while active
- backend RAM while active
- the necessary AI/search provider request

Temporary chats must never be written to:
- Supabase/Postgres
- SQLite
- AsyncStorage
- SecureStore
- iCloud
- Kalillac conversation-history database
- analytics
- crash reports
- session replay
- permanent server logs
- vector database

Required session cleanup:
- End/New Chat: immediate best-effort purge
- abandoned sessions: server-side idle TTL
- absolute server expiration as backstop

Initial idle TTL target: about 60 minutes, tunable after testing.

Never log:
- prompts
- completions
- search query text
- uploaded file contents
- Authorization header values

Allowed telemetry:
- request id
- opaque session hash
- provider/model
- token counts
- estimated cost
- latency
- status/error class
- search used yes/no
- subscription tier
- platform

No advertising profile.
No session replay.
No content-based user profile.

## 5. SEARCH PRIVACY
Search provider receives only a minimally derived query, never the full conversation.

Preferred:
- Brave Search API if terms/privacy fit
- Tavily as alternative

Flow:
User → Kalillac derives minimal query → search provider → results → model with only necessary context → citations

## 6. TEMPORARY FILES
For temporary chats:
- RAM first
- encrypted temporary storage only when necessary
- short TTL
- automatic cleanup
- no vector DB
- no permanent document library
- no Supabase Storage
- avoid persistent provider Files APIs

## 7. SAVED CHATS
Saving is explicit.

V1:
**Save this chat → Save on this iPhone**

Saved chats are encrypted locally.

No cloud sync in v1.

Later:
**Sync across devices**
- explicit opt-in
- likely Sign in with Apple
- client-side encryption
- temporary chats are never retroactively uploaded

## 8. ACCOUNTS AND SUBSCRIPTIONS
No traditional Kalillac account required to:
- chat
- use free tier
- purchase Plus

Use:
- Apple StoreKit
- RevenueCat
- anonymous RevenueCat App User ID
- Restore Purchases

Do not require username, password or email for normal use.

## 9. MONETIZATION
Provisional Plus price:
**$7.99/month**

Paid features:
- Smart
- controlled Deep allowance
- higher usage
- more search
- files/images
- longer conversations
- local saved chats
- no ads

Never promise unlimited expensive AI.

Maintain a hidden server-side variable-cost budget per paid user.

If premium allowance is exhausted:
- reduce/block Deep
- gracefully fall back to cheaper modes
- keep the app useful

Final limits will be based on measured usage.

## 10. VISUAL STANDARD
The app must look credible beside major consumer AI apps.

Required:
- distinct Kalillac visual identity
- restrained premium design
- excellent spacing
- professional typography
- polished dark/light themes
- smooth streaming
- native-feeling controls
- strong paywall
- polished empty/loading/error/offline states
- privacy indicators without clutter

A generic AI-generated template is failure.

## 11. BUILD TOOLING
Primary builder:
**Replit Agent**

Replit is a development tool only, not a production dependency.

If Replit is canceled:
- app still works
- backend still works
- subscriptions still work
- source still exists

Source of truth:
**GitHub**

Secondary engineer/reviewer:
**Grok / Grok Build**

If Replit produces weak work, move the same GitHub repo to another builder.

## 12. TECH STACK
Mobile:
- React Native
- Expo
- TypeScript
- Expo Router

Backend:
- Python
- FastAPI
- independently hosted, initially DigitalOcean or equivalent

Database/Auth:
- Supabase/PostgreSQL only where needed
- never for temporary chats

Subscriptions:
- RevenueCat + StoreKit

Provider API keys:
- server-side only

No model calls directly from the mobile client.

## 13. DEVELOPMENT MILESTONES

### Milestone 0 — Architecture review
Replit returns a plan before coding:
- architecture
- directory structure
- state management
- navigation
- design system
- dependencies
- Milestone 1 sequence

### Milestone 1 — Premium mobile shell
Mock/local data only.
Run on a physical iPhone.

Must include:
- onboarding
- home/new chat
- Auto/Fast/Smart/Deep
- task entry points
- chat UI
- attachments UI
- mock streaming
- research/search presentation
- Markdown/code/tables
- temporary/saved distinction
- conversation list
- settings
- privacy/provider details
- paywall
- dark/light
- animations/haptics
- accessibility
- loading/error/offline states

Acceptance: a stranger should believe it is a professionally designed subscription app.

### Milestone 2 — Backend/models
- FastAPI
- Auto router
- Groq/OpenAI
- streaming/cancel
- provider fallbacks
- cost metering
- content-free operational logs

### Milestone 3 — Search/files/images
- query-only search
- citations
- temporary attachments
- PDFs/docs/images
- TTL cleanup

### Milestone 4 — Subscriptions
- RevenueCat
- StoreKit
- anonymous Plus
- Restore Purchases
- hard cost limits
- graceful budget exhaustion

### Milestone 5 — Privacy/security hardening
Verify:
- no temporary transcript persistence
- no prompt/response logs
- no analytics leakage
- app-switcher privacy overlay
- cache/file cleanup
- provider-key isolation
- rate limiting
- abuse protection
- accurate privacy disclosures

### Milestone 6 — Beta/App Store
- physical-device testing
- TestFlight
- regression tests
- provider outage tests
- heavy-use tests
- privacy labels
- privacy policy
- terms
- AI-provider disclosure/consent
- final UI polish
- submission build

## 14. TARGET TIMELINE
Aggressive target if tooling cooperates:

Day 1:
- architecture/design frozen
- Replit starts UI

Days 1–3:
- premium shell

Days 3–5:
- backend/models/router/metering

Days 5–7:
- search/files/privacy/subscriptions

Days 7–10:
- device/security/regression/UI testing

Days 10–14:
- TestFlight/App Store candidate

This is a target, not a promise. Do not intentionally stretch the project into months.

## 15. BUDGET
Early build/validation:
about $100–$150

Initial launch ceiling:
about $500 unless evidence justifies more.

Spend only when needed. Do not prepay large builder commitments.

## 16. BUSINESS POSITIONING
Do not market as merely “cheaper ChatGPT.”

Position as:
**A privacy-first AI toolbox that gives users strong models and modern AI capabilities without automatically creating a permanent record of every conversation.**

Privacy is the primary differentiator.
Low price, great UI and intelligent routing support it.

## 17. RELEASE GATES
Do not ship unless:
- UI is premium
- temporary chat persistence is absent
- privacy behavior is verified
- provider/API keys are protected
- cost controls work
- streaming is stable
- search citations work
- attachments clean up
- subscriptions and Restore Purchases work
- accessibility is acceptable
- crash/error handling works
- rate limiting exists
- App Store privacy disclosures are accurate
- reviewer can see clear value beyond a generic wrapper

## 18. DO NOT
- touch existing live Kalillac web production
- store temporary chats for debugging
- use prompt text in analytics
- enable session replay
- add advertising SDKs
- promise unlimited Terra
- let Replit own production infrastructure
- call AI providers directly from the app
- add many providers at launch
- force account creation
- add cloud chat sync in v1
- sacrifice UI quality for speed
- make privacy claims broader than verified behavior

## 19. EXISTING KALILLAC PRINCIPLES TO PRESERVE
- no persistent history by default
- no long-term profile by default
- session-scoped context
- explicit provider boundaries
- routing before model use
- local/deterministic handling where possible
- bounded resource use
- honest limitations
- privacy/security claims stop where verification stops

## 20. CURRENT NEXT ACTION
1. Open Replit.
2. Create a new mobile app with Agent.
3. Give Replit the approved master architecture prompt.
4. Require a plan before coding.
5. Review that plan.
6. Approve only if it matches this file.
7. Begin Milestone 1.

If this file is used later, determine the last completed milestone and continue. Do not restart.

## SHORT REMINDER BLOCK
Resume the Kalillac commercial app using the Canonical Project Plan dated September 22, 2026. Privacy is primary. Temporary chats are default and never persist in Kalillac storage; Save is explicit and v1 save is encrypted local-only. No account required to chat or subscribe. Fast = Groq gpt-oss-120b with ZDR, Smart = GPT-5.6 Luna with store=false, Deep = GPT-5.6 Terra with store=false, Auto routes for capability/cost/privacy. Replit Agent is the primary builder but not a production dependency; GitHub owns source, React Native/Expo/TypeScript mobile, FastAPI backend independently hosted, RevenueCat/StoreKit for anonymous subscriptions. Build premium UI first, then backend/models/search/files/subscriptions/security. Do not touch live Kalillac web production. Move fast.
