# Research Report: Gemini Provider Implementation for Archon VS Code Extension
*Generated: 2026-03-17 | Time budget: 10m | Sources consulted: 22*

## Executive Summary

- **A Gemini "subscription login" (analogous to the OpenAI ChatGPT Plus OAuth) is NOT possible.** Google's consumer subscription (Google AI Pro/Ultra) and the Gemini Developer API are completely separate billing systems. Google explicitly prohibits third-party tools from accessing the Code Assist backend and actively enforces bans.
- **Two viable authentication modes exist**: API Key (simplest) and OAuth for the Gemini Developer API (better UX, but still pay-per-token billing).
- **The recommended SDK is `@google/genai` (v1.45.0+)**, Google's new unified Gen AI SDK. The older `@google/generative-ai` package is deprecated and archived.
- **An OpenAI-compatible endpoint exists** at `generativelanguage.googleapis.com/v1beta/openai/` that supports Chat Completions with streaming and function calling, but is in beta with limitations.
- **Implementation effort is moderate**: The existing provider architecture (ProviderId, LLMProvider interface, ProviderManager) makes adding a new provider straightforward.

## Project Context

- **Stack**: TypeScript, pnpm workspaces + turborepo, CJS output
- **Existing providers**: OpenRouter (API key), OpenAI (API key + OAuth subscription), Claude CLI (subprocess)
- **Provider interface**: `LLMProvider` in `packages/core/src/providers/types.ts` with `isAvailable()`, `getModels()`, `createExecutor()`
- **Auth pattern**: VS Code Secret Storage for keys, Global State for modes, OAuth PKCE for OpenAI subscription
- **Key deps**: `@openrouter/sdk`, `@modelcontextprotocol/sdk`, `zod`

## Why Gemini Subscription Login Won't Work

### The Subscription vs API Divide

Google's consumer AI subscriptions and the Gemini Developer API are **completely separate products** [1]:

| Product | Access | Billing | Endpoint |
|---------|--------|---------|----------|
| Google AI Pro ($19.99/mo) | Gemini web app, Code Assist, Gemini CLI | Subscription | `cloudcode-pa.googleapis.com/v1internal` |
| Google AI Ultra ($249.99/mo) | Same as Pro with higher limits + Gemini 3 Pro | Subscription | `cloudcode-pa.googleapis.com/v1internal` |
| Gemini Developer API (Free tier) | API access, rate-limited | Free | `generativelanguage.googleapis.com` |
| Gemini Developer API (Paid tiers) | API access, higher limits | Pay-per-token | `generativelanguage.googleapis.com` |

The subscription gives enhanced access to Google's own tools (gemini.google.com, Gemini Code Assist IDE extension, Gemini CLI), but **NOT** to the public `generativelanguage.googleapis.com` API endpoint [1][2].

### Google Actively Bans Third-Party Access to Code Assist Backend

In February-March 2026, Google issued mass 403 ToS bans against paid subscribers using third-party tools (OpenClaw, OpenCode, etc.) that accessed the Code Assist backend [3][4]. Google's official statement:

> "Using third-party software, tools, or services to harvest or piggyback on Gemini CLI's OAuth authentication to access our backend services is a direct violation." [4]

Consequences include:
- First violation: email notification + specific error message
- Second violation: **permanent suspension** (affecting ALL Google services — Gmail, Drive, etc.)

### Contrast with OpenAI

OpenAI allows ChatGPT Plus/Pro subscribers to use their subscription credentials with third-party tools via the Codex CLI OAuth flow (client ID `app_EMoamEEZ73f0CkXaXp7hrann`, endpoint `chatgpt.com/backend-api/codex`). **Google has no equivalent mechanism and explicitly prohibits the pattern.**

## What IS Possible: Two Auth Modes

### Mode 1: API Key (Recommended Default)

Users generate a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). This is the simplest path and supports both free and paid tiers [5].

- **Free tier**: Access to Gemini 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite (rate-limited, data used for training)
- **Paid tiers**: Higher limits, data NOT used for training, requires Google Cloud billing account
  - Tier 1: $250/month cap
  - Tier 2: $2,000/month cap (requires $100+ cumulative spend + 3 days)
  - Tier 3: $20,000-$100,000+ cap (requires $1,000+ cumulative spend + 30 days)

### Mode 2: OAuth for Gemini Developer API (Optional, Better UX)

Google provides official OAuth documentation for the Gemini Developer API for desktop apps [6][7]. This uses the standard Google OAuth 2.0 installed app flow:

- **Authorization endpoint**: `https://accounts.google.com/o/oauth2/v2/auth`
- **Token endpoint**: `https://oauth2.googleapis.com/token`
- **Redirect**: `http://127.0.0.1:{port}` (loopback to local HTTP server)
- **PKCE**: Recommended (S256 method)
- **Scope**: `https://www.googleapis.com/auth/cloud-platform`
- **Auth header**: `Authorization: Bearer <access_token>` + `x-goog-user-project: <project_id>`

**Important**: This OAuth flow still uses **pay-per-token billing** on the user's Google Cloud project, NOT their consumer subscription. Users must have a Google Cloud project with the Generative Language API enabled and billing configured.

**Caveat**: Unlike OpenAI's OAuth which just requires a subscription, Google OAuth requires users to:
1. Create a Google Cloud Console project
2. Enable the Generative Language API
3. Set up billing
4. Configure OAuth consent screen

This makes the OAuth flow significantly more complex for end users. **API key mode is likely the better default experience.**

## SDK & API Options

### Option A: `@google/genai` SDK (Recommended)

The new unified Google Gen AI SDK [8][9]. Latest version: **1.45.0** (GA since May 2025).

```typescript
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'GEMINI_API_KEY' });

// Streaming
const response = await ai.models.generateContentStream({
  model: 'gemini-2.5-flash',
  contents: 'Hello',
});
for await (const chunk of response) {
  process.stdout.write(chunk.text || '');
}

// Model listing
const models = await ai.models.list();
for await (const model of models) {
  console.log(model.name, model.displayName);
}

// Function calling
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'What is the weather?',
  config: {
    tools: [{ functionDeclarations: [weatherDecl] }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
  },
});
console.log(response.functionCalls);
```

**Pros**: Full feature access, streaming, function calling, model listing, GA status, active development
**Cons**: Gemini-specific API surface (different from OpenAI), no built-in OAuth for desktop apps

### Option B: OpenAI-Compatible Endpoint (Simpler Integration)

Google provides an OpenAI-compatible endpoint [10] that could reuse existing OpenAI client code:

```typescript
import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: "GEMINI_API_KEY",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

const response = await openai.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});
```

**Pros**: Familiar API, could share code with OpenAI provider, streaming via standard SSE
**Cons**: Beta status, cannot combine function calling + JSON mode [11], no `/responses` endpoint (only `/chat/completions`), some features require `extra_body`

### Option C: Direct REST API

- Non-streaming: `POST generativelanguage.googleapis.com/v1beta/{model}:generateContent`
- Streaming: `POST generativelanguage.googleapis.com/v1beta/{model}:streamGenerateContent?alt=sse`
- Model listing: `GET generativelanguage.googleapis.com/v1beta/models?key=$API_KEY`

**Pros**: Full control, no extra dependencies
**Cons**: More boilerplate

### Recommendation

**Use `@google/genai` SDK** for the primary implementation. It provides the best feature coverage and is the officially supported path. The OpenAI-compatible endpoint could be an additional option for users who prefer it but has too many limitations for primary use.

## Model Listing API

REST endpoint: `GET https://generativelanguage.googleapis.com/v1beta/models?key=$API_KEY` [12]

Each model object contains:
- `name` (e.g., `models/gemini-2.5-flash`)
- `displayName`, `description`
- `inputTokenLimit`, `outputTokenLimit`
- `supportedGenerationMethods` (e.g., `["generateContent", "countTokens"]`)
- `thinking` (boolean)
- `temperature`, `topP`, `topK`

With the SDK: `await ai.models.list()` returns a `Pager<Model>` supporting async iteration [9].

## Streaming

- **Native SDK**: `ai.models.generateContentStream()` returns async iterable of chunks with `.text` property [9]
- **REST**: `?alt=sse` query param enables SSE format; each event is a complete `GenerateContentResponse` JSON [12]
- **OpenAI-compat**: Standard `stream: true` with `chunk.choices[0].delta.content` [10]

## Function/Tool Calling

- Uses `FunctionDeclaration` objects with JSON Schema parameters [13]
- Four modes: AUTO, ANY, NONE, VALIDATED
- Parallel function calling supported (multiple `functionCalls` in one response)
- Results sent back as `functionResponse` parts
- Best practices: limit to 10-20 active tools, low temperature for deterministic calls

## Implementation Plan

### Files to Create/Modify

1. **`packages/core/src/providers/types.ts`** — Add `'gemini'` to `ProviderId` union type
2. **`packages/core/src/providers/gemini-provider.ts`** — New provider implementing `LLMProvider`
3. **`packages/core/src/providers/gemini-client.ts`** — API client using `@google/genai` SDK
4. **`packages/core/package.json`** — Add `@google/genai` dependency
5. **`packages/core/src/providers/index.ts`** — Export new provider
6. **`packages/vscode/src/extension/chat-view-provider.ts`** — Register Gemini provider, handle messages
7. **`packages/vscode/src/webview/components/SettingsPanel.tsx`** — Add Gemini settings section

### Provider Structure

```typescript
// gemini-provider.ts
export class GeminiProvider implements LLMProvider {
  id = 'gemini' as const;
  name = 'Google Gemini';

  private apiKey: string = '';

  setApiKey(key: string): void { this.apiKey = key; }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async getModels(): Promise<ModelInfo[]> {
    // Use @google/genai SDK to list models
    // Filter to those supporting 'generateContent'
  }

  createExecutor(config: ExecutorConfig): Executor {
    // Return GeminiExecutor that handles streaming + tool calling
  }
}
```

### Authentication Flow (API Key Only for v1)

For the initial implementation, support **API key mode only**:
- User enters API key in Settings panel
- Key stored in VS Code Secret Storage (`archon.geminiApiKey`)
- Key passed to `@google/genai` SDK constructor

OAuth can be added later if there's demand, but the complexity for end users (Cloud project setup, billing, consent screen) makes it a poor default experience.

### Estimated Effort

| Component | Effort | Notes |
|-----------|--------|-------|
| `gemini-provider.ts` | ~200 lines | Auth, model listing, provider interface |
| `gemini-client.ts` | ~400 lines | Streaming executor, function calling, response parsing |
| `types.ts` update | ~5 lines | Add 'gemini' to ProviderId |
| `chat-view-provider.ts` | ~50 lines | Register provider, handle messages |
| `SettingsPanel.tsx` | ~80 lines | API key input section |
| Testing & debugging | — | Tool calling format mapping, streaming edge cases |

## Counter-Arguments

1. **"Why not use OpenAI-compat endpoint to share code?"** — The endpoint is in beta, cannot combine function calling + JSON mode, and doesn't support `/responses`. The native SDK gives full access and is GA. The code sharing benefit is minimal since the executor layer already abstracts provider differences.

2. **"Why not support subscription OAuth anyway?"** — Google has demonstrated willingness to ban accounts entirely, affecting ALL Google services. The risk to users is unacceptable. This is fundamentally different from OpenAI's approach.

3. **"Why not Vertex AI?"** — Vertex AI requires Google Cloud project setup, service accounts, and is designed for enterprise. The Gemini Developer API (ai.google.dev) is the intended path for individual developers and VS Code extensions [14].

## Gaps & Limitations

- **No subscription-based auth**: Unlike OpenAI, there is no way to let users "sign in with their Gemini subscription" for free API access. This is a fundamental limitation of Google's product architecture.
- **OAuth complexity**: While technically possible, OAuth for the Gemini Developer API requires users to set up Google Cloud projects — much more friction than OpenAI's simple subscription OAuth.
- **EEA/Switzerland/UK restriction**: The Gemini API Terms of Service require that apps serving users in these regions must use Paid Services only (no free tier) [15].
- **Free tier training**: On the free tier, Google uses prompts/responses for training. Paid tier opts out [5].

## Suggested Follow-ups

1. **Start with API key mode only** — implement `GeminiProvider` + `GeminiClient` using `@google/genai` SDK
2. **Consider OpenAI-compat as alternative auth** — let users point the existing OpenAI provider at Gemini's OpenAI-compatible endpoint via custom base URL
3. **Monitor Google's stance on third-party access** — if Google ever opens a subscription-based API (like OpenAI did), add it then
4. **Add to MemoryLlmProvider** — support Gemini as a memory system backend for summarization

## Sources

1. [AIonX - Gemini Advanced API Access Guide](https://aionx.co/gemini-advanced-reviews/gemini-advanced-api-access/) — undated — Confirms subscription/API separation
2. [Gemini Code Assist Quotas](https://developers.google.com/gemini-code-assist/resources/quotas) — current — Code Assist rate limits by subscription tier
3. [Google AI Forum - Mass 403 ToS Bans](https://discuss.ai.google.dev/t/urgent-mass-403-tos-bans-on-gemini-api-antigravity-for-open-source-cli-users-paid-tier/124508) — February 2026 — Ban enforcement details
4. [Gemini CLI Discussion #20632](https://github.com/google-gemini/gemini-cli/discussions/20632) — February-March 2026 — Google's official prohibition statement
5. [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — current — Free/paid tiers, training data usage policy
6. [Gemini API OAuth Quickstart](https://ai.google.dev/gemini-api/docs/oauth) — updated March 12, 2026 — Desktop app OAuth flow
7. [Google OAuth 2.0 for Native Apps](https://developers.google.com/identity/protocols/oauth2/native-app) — current — OAuth flow details, PKCE, redirect URIs
8. [@google/genai on npm](https://www.npmjs.com/package/@google/genai) — current — v1.45.0, GA since May 2025
9. [googleapis/js-genai GitHub](https://github.com/googleapis/js-genai) — current — SDK source, examples, API surface
10. [Gemini OpenAI Compatibility](https://ai.google.dev/gemini-api/docs/openai) — current — OpenAI-compatible endpoint docs
11. [Gemini OpenAI Limitations Blog](https://adam.strojek.info/posts/2025-07-10-uncovering-limitations-of-gemini-over-openai/) — July 2025 — Function calling + JSON mode incompatibility
12. [Gemini API Models Reference](https://ai.google.dev/api/models) — current — Model listing endpoint, response schema
13. [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling) — updated February 2026 — Function declaration format, modes
14. [Google AI Studio vs Vertex AI](https://ai.google.dev/gemini-api/docs/migrate-to-cloud) — current — Comparison and migration guide
15. [Gemini API Terms of Service](https://ai.google.dev/gemini-api/terms) — current — EEA/Switzerland/UK restriction
