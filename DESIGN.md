# Integrelli — Technical Design (MVP, one-pass build)

Scope is locked by the product brief. This doc is guidance for implementation, not a checklist.
Build the thin slice. If a bullet here is not load-bearing for the core loop
(prompt -> plan -> inspect -> run mock -> edit mapping -> re-run), defer it.

---

## 1. File tree

```
Integrelli/
├── package.json                      deps + scripts (dev, build, embed, test)
├── tsconfig.json                     strict: true, paths: "@/*" -> "./src/*"
├── next.config.ts                    minimal; no edge
├── tailwind.config.ts                dark-first theme tokens
├── postcss.config.mjs                tailwind/autoprefixer
├── vitest.config.ts                  node env, alias @/ -> src/
├── .env.example                      AI_GATEWAY_API_KEY + per-service integration keys
├── DESIGN.md                         this file
│
├── scripts/
│   └── build-embeddings.ts           build-time: embed every endpoint doc -> static index JSON
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                root shell, fonts, global CSS
│   │   ├── globals.css               tailwind directives + a few CSS vars
│   │   ├── page.tsx                  single-page app: composes all panels, owns nothing
│   │   └── api/
│   │       ├── plan/route.ts         POST: prompt -> retrieval -> LLM -> validated WorkflowPlan
│   │       ├── execute/route.ts      POST: plan + runtime opts -> ExecutionTrace
│   │       └── env-status/route.ts   GET: which services have keys present (booleans only)
│   │
│   ├── types/
│   │   ├── endpoint.ts               EndpointSpec, AuthStyle, ParamSpec, JsonValue
│   │   ├── workflow.ts               WorkflowPlan, WorkflowStep, FieldMapping, TriggerSpec
│   │   ├── execution.ts              ExecutionTrace, StepResult, Attempt, FaultInjection, RunOptions
│   │   └── index.ts                  re-exports
│   │
│   ├── schemas/
│   │   ├── workflow.zod.ts           Zod mirrors of WorkflowPlan/Step/FieldMapping (import/export + LLM output)
│   │   ├── execution.zod.ts          Zod for /api/execute request body
│   │   └── plan-request.zod.ts       Zod for /api/plan request body
│   │
│   ├── knowledge/
│   │   ├── index.ts                  ALL_ENDPOINTS array + byId Map + assertion that ids are unique
│   │   ├── elevenlabs.ts             3+ EndpointSpec
│   │   ├── stripe.ts                 3+ EndpointSpec
│   │   ├── gmail.ts                  3+ EndpointSpec
│   │   ├── slack.ts                  3+ EndpointSpec
│   │   ├── twilio.ts                 3+ EndpointSpec
│   │   ├── notion.ts                 3+ EndpointSpec
│   │   ├── openai.ts                 3+ EndpointSpec
│   │   └── airtable.ts               3+ EndpointSpec
│   │
│   ├── generated/
│   │   └── embedding-index.json      committed output of scripts/build-embeddings.ts
│   │
│   ├── templates/
│   │   ├── index.ts                  BUILTIN_TEMPLATES: {id,name,description,plan}[] (parsed through Zod at import)
│   │   ├── elevenlabs-stripe-gmail.json   demo template (the headline one)
│   │   ├── call-to-notion-slack.json      transcript -> Notion page -> Slack notify
│   │   ├── stripe-receipt-sms.json        payment -> Twilio SMS + Airtable row
│   │   └── openai-summary-email.json      OpenAI summarize -> Gmail send
│   │
│   ├── lib/
│   │   ├── retrieval/
│   │   │   ├── embed.ts              embedQuery(text) via AI Gateway embedding model
│   │   │   ├── index-loader.ts       load + validate static index, cache in module scope
│   │   │   ├── similarity.ts         cosine + top-k
│   │   │   ├── lexical.ts            keyword fallback scorer (no network)
│   │   │   └── retrieve.ts           retrieveCandidates(prompt, k) -> RetrievedEndpoint[]
│   │   ├── llm/
│   │   │   ├── model.ts              MODEL_ID constant + gateway client wiring
│   │   │   ├── system-prompt.ts      buildSystemPrompt(candidates) -> string
│   │   │   └── generate-plan.ts      generateObject + repair loop -> {plan, issues}
│   │   ├── mapping/
│   │   │   ├── ref.ts               parse/validate $trigger and $steps refs
│   │   │   ├── resolve.ts           resolve mappings -> concrete request (or Unresolved errors)
│   │   │   ├── compose.ts           flat FieldMapping[] -> nested body/headers/query/path
│   │   │   └── validate.ts          Ajv validation of composed body vs endpoint.requestSchema
│   │   ├── exec/
│   │   │   ├── engine.ts            runWorkflow(plan, options) -> ExecutionTrace
│   │   │   ├── adapter.ts           HttpAdapter interface + RawHttpResponse
│   │   │   ├── mock-adapter.ts      deterministic mock responses from response JSON Schema
│   │   │   ├── live-adapter.ts      real fetch adapter (off by default)
│   │   │   ├── mock-values.ts       JSON Schema -> seeded fake value
│   │   │   ├── rng.ts               mulberry32 + hashString (deterministic seeding)
│   │   │   ├── retry.ts             shouldRetry + backoffMs policy
│   │   │   └── redact.ts            strip secret values from anything entering the trace
│   │   ├── storage/
│   │   │   └── local-templates.ts   localStorage CRUD for user-saved templates
│   │   ├── io/
│   │   │   └── workflow-file.ts     export to JSON blob / import + Zod-parse with error surface
│   │   ├── state/
│   │   │   └── store.ts             zustand store: plan, trace, seed, mode, faults, selection
│   │   └── utils/
│   │       ├── json-path.ts         get/set by dotted path with [n] indices
│   │       └── cn.ts               className merge helper
│   │
│   └── components/
│       ├── AppShell.tsx              3-pane layout (prompt bar top, inspector left, run right)
│       ├── PromptBar.tsx             textarea + Generate button + loading/error state
│       ├── TemplateBar.tsx           builtin + saved templates, load / save-current
│       ├── ImportExportButtons.tsx   download JSON, upload JSON, parse-error toast
│       ├── inspector/
│       │   ├── WorkflowInspector.tsx ordered list container + issues banner
│       │   ├── TriggerCard.tsx       described trigger node (not a listener) + sample payload
│       │   ├── StepCard.tsx          collapsed summary; expands to tabs
│       │   ├── EndpointTab.tsx       full URL, method, apiVersion, auth style, description
│       │   ├── HeadersTab.tsx        headers with masked secret rendering
│       │   ├── RequestTab.tsx        composed body + per-field provenance chips
│       │   ├── ResponseTab.tsx       response JSON Schema + example payload
│       │   └── MappingEditor.tsx     edit one FieldMapping (kind switch + value/ref picker)
│       ├── run/
│       │   ├── RunPanel.tsx          seed input, mode toggle, Run button
│       │   ├── ModeToggle.tsx        test/live; live disabled unless env-status ready
│       │   ├── FaultInjectionPanel.tsx per-step forced 429/500 + attempt count
│       │   ├── TraceView.tsx         ordered StepResults
│       │   ├── TraceStepRow.tsx      status, latency, attempts, rate-limit warning
│       │   └── AttemptList.tsx       per-attempt status + backoff shown
│       └── ui/
│           ├── JsonViewer.tsx        collapsible pretty JSON
│           ├── Badge.tsx             status/method/provenance pills
│           └── Tabs.tsx              minimal accessible tabs
│
└── tests/
    ├── knowledge.test.ts             every endpoint: unique id, valid JSON Schemas, example matches schema
    ├── retrieval.test.ts             index covers all endpoints; cosine top-k sanity; lexical fallback
    ├── mapping.test.ts               ref parsing, composition, unresolved-required detection
    ├── determinism.test.ts           same seed+plan => byte-identical trace JSON (twice)
    ├── retry.test.ts                 429 fault => 3 attempts, backoff sequence recorded
    └── io.test.ts                    export -> import round-trip preserves plan
```

---

## 2. Core types (verbatim)

`src/types/endpoint.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

/** Minimal JSON Schema subset we author and consume. Draft-07 compatible. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  format?: 'email' | 'uri' | 'date-time' | 'uuid';
  description?: string;
  example?: JsonValue;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
}

export type AuthStyle =
  | { kind: 'bearer'; envVar: string }
  | { kind: 'header'; headerName: string; envVar: string }
  | { kind: 'basic'; usernameEnvVar: string; passwordEnvVar: string }
  | { kind: 'query'; paramName: string; envVar: string };

export type ParamLocation = 'path' | 'query' | 'header';

export interface ParamSpec {
  name: string;
  location: ParamLocation;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  description: string;
  example?: JsonPrimitive;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One hand-authored endpoint in the knowledge pack. */
export interface EndpointSpec {
  /** Stable, human-readable, unique. Format: "<service>.<verb_noun>" e.g. "stripe.create_payment_link". */
  id: string;
  service: ServiceId;
  serviceLabel: string;
  apiVersion: string;
  method: HttpMethod;
  /** Path template with :param placeholders, e.g. "/v1/users/:userId/messages/send". */
  path: string;
  baseUrl: string;
  auth: AuthStyle;
  /** Static headers always sent (content-type, api-version, etc). Values may contain no secrets. */
  headers: Record<string, string>;
  params: ParamSpec[];
  requestSchema: JsonSchema | null;   // null for GET/DELETE with no body
  responseSchema: JsonSchema;
  exampleResponse: JsonValue;
  description: string;
  keywords: string[];
  docsUrl?: string;
}

export type ServiceId =
  | 'elevenlabs' | 'stripe' | 'gmail' | 'slack'
  | 'twilio' | 'notion' | 'openai' | 'airtable';

/** The knowledge pack "entry" as consumed by retrieval: spec + its precomputed embedding. */
export interface KnowledgeEntry {
  spec: EndpointSpec;
  /** Text that was embedded; kept for debugging + lexical fallback. */
  documentText: string;
  embedding: number[];
}

export interface EmbeddingIndexFile {
  model: string;
  dimensions: number;
  builtAt: string;
  /** Hash of concatenated documentText, used to detect a stale index at boot. */
  corpusHash: string;
  entries: Array<{ id: string; documentText: string; embedding: number[] }>;
}

export interface RetrievedEndpoint {
  spec: EndpointSpec;
  score: number;
  method: 'embedding' | 'lexical';
}
```

`src/types/workflow.ts`

```ts
import type { JsonValue, JsonSchema, ServiceId } from './endpoint';

/**
 * Reference expression. Restricted grammar (NOT full JSONPath):
 *   $trigger.payload.<dotted.path>
 *   $steps.<stepId>.response.<dotted.path>
 * Array indexing with [n] is allowed inside the dotted path.
 */
export type RefExpression = string;

export type MappingSource =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'secret'; envVar: string }
  | { kind: 'ref'; expression: RefExpression }
  | { kind: 'unresolved'; reason: string };

export type MappingTarget = 'body' | 'header' | 'query' | 'path';

/** One bound input on a step. Flat list is the single source of truth for the request. */
export interface FieldMapping {
  /** Dotted path within the target, e.g. "line_items[0].price" or "Content-Type". */
  path: string;
  target: MappingTarget;
  source: MappingSource;
  /** True if the endpoint schema marks this field required. Drives the error banner. */
  required: boolean;
  note?: string;
}

export interface TriggerSpec {
  service: ServiceId | 'manual';
  /** e.g. "elevenlabs.call.completed" */
  eventName: string;
  description: string;
  /** Shape of the described event payload; steps may $trigger.payload.* into it. */
  payloadSchema: JsonSchema;
  samplePayload: JsonValue;
}

export interface WorkflowStep {
  /** Stable, referenced by $steps.<id>. Format: "step_1", "step_2", ... */
  id: string;
  order: number;
  endpointId: string;
  title: string;
  rationale: string;
  mappings: FieldMapping[];
}

export interface PlanIssue {
  severity: 'error' | 'warning';
  stepId?: string;
  path?: string;
  code:
    | 'unknown_endpoint'
    | 'unresolved_required_field'
    | 'invalid_ref'
    | 'schema_violation'
    | 'llm_output_invalid'
    | 'forward_reference';
  message: string;
}

export interface WorkflowPlan {
  version: 1;
  id: string;
  name: string;
  description: string;
  prompt: string;
  trigger: TriggerSpec;
  steps: WorkflowStep[];
  /** Non-fatal problems detected at plan time; rendered in the inspector. */
  issues: PlanIssue[];
  createdAt: string;
}
```

`src/types/execution.ts`

```ts
import type { JsonValue } from './endpoint';
import type { WorkflowPlan, PlanIssue } from './workflow';

export type ExecutionMode = 'test' | 'live';

export interface FaultInjection {
  stepId: string;
  status: 429 | 500 | 502 | 503;
  /** Fail this many leading attempts, then succeed. 'all' fails every attempt. */
  applyToAttempts: number | 'all';
  /** Optional override of the mocked error body. */
  body?: JsonValue;
}

export interface RunOptions {
  seed: string;
  mode: ExecutionMode;
  faults: FaultInjection[];
  /** Hard cap; engine stops after this many steps. */
  maxSteps?: number;
}

export interface PreparedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;   // secrets already masked for the trace copy
  query: Record<string, string>;
  body: JsonValue | null;
}

export interface Attempt {
  attempt: number;              // 1-based
  status: number;
  /** Synthesized in test mode from the seeded RNG; measured in live mode. */
  latencyMs: number;
  /** Delay recorded before this attempt (0 for attempt 1). Not slept in test mode. */
  backoffMs: number;
  responseBody: JsonValue | null;
  responseHeaders: Record<string, string>;
  error?: { type: 'http' | 'network' | 'timeout'; message: string };
  faultInjected: boolean;
}

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  endpointId: string;
  status: StepStatus;
  request: PreparedRequest;
  attempts: Attempt[];
  /** Final attempt's status code, or null if never dispatched. */
  finalStatus: number | null;
  /** Sum of attempt latencies + recorded backoffs. */
  totalDurationMs: number;
  /** Logical offset from trace start; keeps traces byte-identical across runs. */
  startedAtOffsetMs: number;
  responseBody: JsonValue | null;
  rateLimit?: {
    limit: number | null;
    remaining: number | null;
    resetSeconds: number | null;
    warning: string | null;
  };
  issues: PlanIssue[];
}

export interface ExecutionTrace {
  traceId: string;              // deterministic: hash(seed + plan.id)
  planId: string;
  mode: ExecutionMode;
  seed: string;
  faults: FaultInjection[];
  steps: StepResult[];
  status: 'success' | 'partial' | 'failed';
  totalDurationMs: number;
  /** Never a wall clock in test mode. Live mode sets an ISO timestamp. */
  finishedAt: string | null;
}

export interface ExecuteResponse {
  trace: ExecutionTrace;
}

export interface PlanResponse {
  plan: WorkflowPlan;
  candidates: Array<{ id: string; score: number; service: string; summary: string }>;
  retrievalMethod: 'embedding' | 'lexical';
}
```

---

## 3. Data flow

**Generate:** `PromptBar` -> POST `/api/plan` -> `retrieve.ts` (`index-loader` + `embed` + `similarity`, fallback `lexical`) -> `system-prompt.ts` builds candidate catalog -> `generate-plan.ts` (`generateObject`, AI SDK v6, Zod schema) -> post-process: resolve endpointIds against `knowledge/index.ts`, parse refs (`mapping/ref.ts`), compose (`mapping/compose.ts`), Ajv-validate (`mapping/validate.ts`), collect `PlanIssue[]` -> `PlanResponse` -> zustand `store.ts` -> `WorkflowInspector`.

**Run:** `RunPanel` -> POST `/api/execute` with `{plan, seed, mode, faults}` -> `execute/route.ts` Zod-validates -> `engine.ts` picks `mock-adapter` (test) or `live-adapter` (live + env gate) -> per step: resolve mappings against `$trigger` + prior `StepResult.responseBody` -> `PreparedRequest` -> adapter -> `retry.ts` loop -> `redact.ts` -> `StepResult` -> `ExecutionTrace` -> `TraceView`.

**Edit-and-rerun:** `MappingEditor` mutates one `FieldMapping` in the store -> re-run revalidation locally (same `mapping/*` modules, imported client-side; they are pure and dependency-free except Ajv) -> POST `/api/execute` again with the same seed -> diffable trace. No LLM call on edit.

---

## 4. Retrieval design

- **Model:** `openai/text-embedding-3-small` (1536 dims) through the AI Gateway (`gateway.textEmbeddingModel(...)`). Anthropic has no embedding model; the gateway string keeps one credential.
- **Document text per endpoint** (built by a single shared function used by both the script and any re-embed, so build and query agree):
  `"{serviceLabel} {method} {path}\n{description}\nKeywords: {keywords.join(', ')}\nParameters: {params.map(p => p.name + ' - ' + p.description)}\nRequest fields: {top-level requestSchema property names + descriptions}"`
- **Build script:** `pnpm embed` runs `scripts/build-embeddings.ts` with tsx. It imports `ALL_ENDPOINTS`, builds documentText, calls `embedMany`, writes `src/generated/embedding-index.json` including `corpusHash`. Committed to git so `next build` needs no network.
- **Boot check:** `index-loader.ts` recomputes `corpusHash` from `ALL_ENDPOINTS`; mismatch logs a loud warning and forces lexical mode (never crashes the app).
- **Query time:** embed the raw user prompt once, cosine against all 24 vectors in memory, sort desc. No chunking, no reranking.
- **Candidate count:** top **12** endpoints into the LLM prompt, but always include *all* endpoints from any service whose label/keywords appear literally in the prompt (guarantees "Stripe" mentioned => Stripe endpoints are candidates). Cap the final list at 16.
- **Fallback:** if the embedding call throws or no key is present, `lexical.ts` scores by token overlap over documentText (idf-weighted, lowercased, stopword-stripped) and `retrievalMethod: 'lexical'` is surfaced in the UI.

---

## 5. LLM interaction

Model: `MODEL_ID = 'anthropic/claude-sonnet-4-5'` in `lib/llm/model.ts`, overridable via `process.env.INTEGRELLI_MODEL`. `generateObject` from AI SDK v6.

**Structured output schema** (`schemas/workflow.zod.ts`, the LLM-facing subset — no `issues`, no `createdAt`, no `order`; the server assigns those):

```ts
const MappingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
  z.object({ kind: z.literal('secret'), envVar: z.string().regex(/^[A-Z0-9_]+$/) }),
  z.object({ kind: z.literal('ref'), expression: z.string().startsWith('$') }),
]);

const FieldMappingSchema = z.object({
  path: z.string().min(1),
  target: z.enum(['body', 'header', 'query', 'path']),
  source: MappingSourceSchema,
  note: z.string().optional(),
});

const StepSchema = z.object({
  id: z.string().regex(/^step_\d+$/),
  endpointId: z.string(),
  title: z.string(),
  rationale: z.string(),
  mappings: z.array(FieldMappingSchema),
});

export const PlanOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: z.object({
    service: z.string(),
    eventName: z.string(),
    description: z.string(),
    samplePayload: z.record(z.string(), z.unknown()),
  }),
  steps: z.array(StepSchema).min(1).max(6),
});
```

Note: `unresolved` is deliberately absent from the LLM union — the *server* converts a missing required field into `{kind:'unresolved'}` so the model cannot hide behind it.

**System prompt contents** (`buildSystemPrompt`):
1. Role: senior integration engineer producing a linear, inspectable API workflow.
2. Hard rules: use ONLY `endpointId` values from the catalog; steps are linear (no branching/loops/parallel); max 6 steps; `$steps.<id>` may only reference an earlier step; secrets must use `{kind:'secret', envVar}` and never a literal key; every field the endpoint marks required must appear in `mappings`.
3. Reference grammar with two worked examples (`$trigger.payload.call_id`, `$steps.step_1.response.url`).
4. The candidate catalog: for each candidate — `endpointId`, service, method, path, description, required params, required request-body fields with types/descriptions, and top-level response property names (names only, keeps tokens down).
5. Output contract restated in prose plus "if you cannot satisfy a required field, still emit the mapping with a literal placeholder and explain in `note`".

**Invalid / unresolvable handling:**
- `generateObject` throws or Zod fails -> one repair attempt with the validation error text appended as a user message. Second failure -> 422 `{ error, rawText }`; `PromptBar` shows a retry.
- Unknown `endpointId` -> drop the step, add `unknown_endpoint` issue. If zero steps survive, 422.
- Forward/self reference -> rewrite that source to `{kind:'unresolved'}` + `forward_reference` issue.
- Ajv violation or missing required field -> keep the plan, add `schema_violation` / `unresolved_required_field` issue, and inject an `unresolved` mapping so the field is visible and editable in `MappingEditor`. **Execution of a step with an `unresolved` required mapping is blocked**: `StepStatus = 'skipped'` with the issue attached; downstream steps also skip.

---

## 6. Execution engine

**Determinism.** No `Math.random`, no `Date.now`, no `crypto.randomUUID` anywhere under `lib/exec` in test mode.
- `rng.ts`: `hashString(s): number` (FNV-1a 32-bit) and `mulberry32(seed: number): () => number`.
- Every mock value gets its own RNG: `mulberry32(hashString(`${runSeed}|${stepId}|${attempt}|${schemaPath}`))`. Per-field seeding means adding a step or reordering does not shift other steps' values.
- Latency: `60 + floor(rng() * 340)` ms, synthesized, **never slept** in test mode. Backoff is recorded in `Attempt.backoffMs` but also not slept — the UI shows the backoff sequence without making the demo wait.
- `traceId = hashString(seed + '|' + plan.id).toString(16)`; `finishedAt = null` in test mode. `startedAtOffsetMs` accumulates from synthesized durations.
- Byte-identical guarantee = `JSON.stringify(trace)` equal across runs. `determinism.test.ts` asserts exactly that.

**Mock value derivation** (`mock-values.ts`), in priority order:
1. `schema.example` if present -> return verbatim.
2. `schema.enum` -> pick by `floor(rng() * enum.length)`.
3. By `type`: `object` -> recurse over `properties` (emit `required` always, optional props emitted when `rng() > 0.35`); `array` -> 1–3 items from `items`; `string` -> format-aware (`email` -> `user{n}@example.com`, `uri` -> `https://example.com/{token}`, `date-time` -> fixed epoch base + deterministic offset, `uuid` -> hex from RNG) else `"{propertyName}_{token}"`; `number`/`integer` -> respects `minimum`/`maximum`; `boolean` -> `rng() > 0.5`; `null` -> `null`.
4. Top-level endpoint fallback: if `responseSchema` is thin, merge over `exampleResponse`.

Mock adapter also synthesizes headers: `x-ratelimit-limit`, `x-ratelimit-remaining` (deterministically decreasing per step index within a run), `x-ratelimit-reset`, `x-request-id`.

**Retry / backoff** (`retry.ts`): retryable = status in `{408,429,500,502,503,504}` or a network error. `maxAttempts = 3`. `backoffMs(n) = min(250 * 2 ** (n - 1), 4000)` plus deterministic jitter `floor(rng() * 100)`. `Retry-After` header, when present, wins over the computed backoff. Non-retryable 4xx fails immediately.

**Fault injection:** applied inside the adapter, before any mock generation, so a fault is a first-class response. `applyToAttempts: 2` => attempts 1 and 2 return the fault status, attempt 3 succeeds — which is exactly the "retry is visible in the trace" demo. `Attempt.faultInjected = true` marks them. 429 faults carry `retry-after: 1` and `x-ratelimit-remaining: 0`.

**Rate-limit detection:** parse the three `x-ratelimit-*` headers (case-insensitive, with a per-service header-name alias table since Twilio/Slack differ). Warning when `remaining === 0` or `remaining / limit < 0.2`, or on any 429.

**Live seam:**
```ts
export interface HttpAdapter {
  readonly mode: ExecutionMode;
  send(req: PreparedRequest, ctx: { stepId: string; attempt: number; seed: string }): Promise<RawHttpResponse>;
}
export interface RawHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue | null;
  latencyMs: number;
  error?: { type: 'network' | 'timeout'; message: string };
}
```
`engine.ts` receives an `HttpAdapter` and knows nothing about fetch. Live mode requires all three: `mode === 'live'` in the request, every `secret.envVar` for every step present in `process.env`, and `process.env.INTEGRELLI_ALLOW_LIVE === 'true'`. Any failure -> 400 with the list of missing vars; the engine never silently downgrades. `live-adapter.ts` sleeps real backoffs, applies a 15s `AbortSignal.timeout`, and ignores fault injection.

**Secrets:** resolved only inside `live-adapter.send`. `PreparedRequest.headers` stored in the trace always carries the masked form `Bearer <STRIPE_API_KEY>`. `redact.ts` runs over every outgoing `StepResult` as a belt-and-braces scan for any `process.env` value substring.

---

## 7. API routes

All `export const runtime = 'nodejs'`.

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/plan` | `{ prompt: string (3..2000) }` | `200 PlanResponse` / `422 {error, code, rawText?}` / `400 zod error` |
| POST | `/api/execute` | `{ plan: WorkflowPlan, seed: string, mode: 'test'\|'live', faults: FaultInjection[] }` | `200 { trace: ExecutionTrace }` / `400 {error, missingEnvVars?}` |
| GET | `/api/env-status` | — | `200 { allowLive: boolean, services: Record<ServiceId, { ready: boolean; missing: string[] }> }` — names only, never values |

`/api/execute` re-validates the incoming plan with the full Zod schema — the client can edit mappings, so never trust the body.

---

## 8. Component tree

```
page.tsx
└── AppShell                     layout only; reads nothing
    ├── PromptBar                prompt state, calls /api/plan, sets store.plan
    ├── TemplateBar              BUILTIN_TEMPLATES + localStorage; load replaces plan, save writes current
    ├── ImportExportButtons      download plan JSON; upload -> Zod parse -> plan or error toast
    ├── WorkflowInspector        maps store.plan.steps; renders PlanIssue banner at top
    │   ├── TriggerCard          trigger description + samplePayload (explicitly labeled "described, not live")
    │   └── StepCard[]           collapsed: order/method/service/path/status dot. Expanded ->
    │       └── Tabs
    │           ├── EndpointTab  resolved full URL, apiVersion, auth style, rationale
    │           ├── HeadersTab   merged static + mapped headers, secrets masked
    │           ├── RequestTab   composed body via JsonViewer; each leaf gets a provenance Badge
    │           │   └── MappingEditor  (opened per field) kind switch: literal | secret | ref;
    │           │                       ref mode offers a dropdown of valid prior-step response paths
    │           └── ResponseTab  responseSchema tree + exampleResponse
    └── RunPanel
        ├── ModeToggle           live disabled + tooltip when /api/env-status says not ready
        ├── FaultInjectionPanel  per-step status picker + attempt count
        └── TraceView
            └── TraceStepRow[]   status badge, finalStatus, totalDurationMs, rate-limit warning
                └── AttemptList  attempt N: status, latency, backoff, faultInjected marker
```

State lives in one zustand store (`plan`, `trace`, `seed`, `mode`, `faults`, `expandedStepId`, `isGenerating`, `isRunning`, `envStatus`). Components are otherwise dumb. Seed defaults to `"integrelli"` and is an editable text input — that is the whole determinism UX.

---

## 9. Tradeoffs

1. **Flat `FieldMapping[]` instead of a nested body with a parallel provenance map.** Chose one source of truth so composition and provenance can never drift; gave up direct JSON-shaped editing of the body and pay a compose step on every render.
2. **Embeddings via an OpenAI model on the gateway, computed at build time.** Chose real semantics with zero runtime index cost; gave up a second credential-free path (query-time embedding still needs the gateway) — mitigated by the lexical fallback.
3. **No sleeping on latency or backoff in test mode.** Chose instant, byte-identical reruns; gave up the felt realism of a slow retry — the UI shows the numbers instead.
4. **Execution runs server-side even in test mode.** Chose a single code path shared with live mode so the seam is genuinely exercised; gave up offline/instant local reruns and pay a round trip per run.
5. **Ajv for request validation, Zod for plan structure.** Chose Ajv because endpoint schemas are authored as JSON Schema (a product requirement) and converting them to Zod would lose fidelity; gave up a single validation library and carry both.
6. **Steps with unresolved required fields are skipped, not attempted.** Chose to make the failure legible in the inspector; gave up seeing what a real 400 from the provider would look like.

---

## 10. Build order

1. Scaffold: Next App Router + TS strict + Tailwind + Vitest + path aliases. Verify `pnpm test` and `pnpm dev` run.
2. `src/types/*` verbatim from section 2, then `src/schemas/*` as Zod mirrors. Nothing else starts until these compile.
3. Knowledge pack: `stripe.ts`, `elevenlabs.ts`, `gmail.ts` first (the demo path), then the other five. `knowledge/index.ts` with a unique-id assertion. Write `tests/knowledge.test.ts` alongside — it will catch schema typos immediately.
4. `lib/utils/json-path.ts` + `lib/mapping/*` (ref, compose, resolve, validate) with `tests/mapping.test.ts`. Pure, no network, no React.
5. `lib/exec/*`: `rng` -> `mock-values` -> `adapter`/`mock-adapter` -> `retry` -> `engine` -> `redact`. Write `tests/determinism.test.ts` and `tests/retry.test.ts` here. **The engine must be provably deterministic before any UI exists.**
6. `POST /api/execute` + a hardcoded plan fixture. Curl it twice, diff the JSON.
7. Templates: author the 4 JSONs by hand against the real endpoint ids, parse them through Zod at import. `elevenlabs-stripe-gmail.json` must execute cleanly through step 6.
8. UI shell: `AppShell`, store, `TemplateBar`, `WorkflowInspector`, `StepCard` + tabs, `RunPanel` + `TraceView`. At this point the whole product works minus the LLM.
9. `MappingEditor` + edit-and-rerun. Core loop is now closed.
10. `scripts/build-embeddings.ts` + `lib/retrieval/*` + `tests/retrieval.test.ts`. Commit `embedding-index.json`.
11. `lib/llm/*` + `POST /api/plan` + `PromptBar`. Repair loop and issue surfacing.
12. `FaultInjectionPanel` wiring, rate-limit warnings in `TraceStepRow`.
13. `lib/io/workflow-file.ts` + `ImportExportButtons` + `tests/io.test.ts`; `lib/storage/local-templates.ts` for save-as-template.
14. `live-adapter.ts` + `/api/env-status` + `ModeToggle` gating. Verify test mode makes zero third-party network calls (assert the mock adapter never imports fetch).
15. Polish: empty states, error toasts, loading skeletons, README.

---

## Scope discipline

**Zero diff / not built at all:** no database layer, no auth, no OAuth, no credential UI, no webhook listener, no branching or parallel execution, no drag-and-drop canvas, no codegen, no cost estimation, no streaming.

**This slice requires zero migrations and zero new ports beyond the single `HttpAdapter` interface.** If you find yourself needing a second adapter interface, a persistence layer, or a third API route beyond the three in section 7 — that is a design bug. Stop and flag it rather than improvising.

**Known deferred gaps** (named, deliberately not designed): embedding-quality evaluation, a gold retrieval query set, CI thresholds, provider-specific error-shape normalization beyond rate-limit headers, and adapter conformance testing across all 8 services.

This doc is guidance, not a mandatory checklist. Build thin; defer any bullet that is not load-bearing for the core loop.
