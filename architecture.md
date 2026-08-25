# Integration Intelligence Architecture

Living document. Last substantive update: Day 1.

---

## 1. Product Goal

Turn a plain-English automation request into a structurally valid, inspectable
integration workflow, built from third-party API knowledge the system ingested
and verified rather than from what a language model happens to remember.

The bet is that the hard part is not generation. The hard part is the knowledge
layer: converting messy, inconsistent, versioned third-party API documentation
into a capability graph precise enough that a generated plan can be *checked*
rather than trusted.

Day 1 answers one question:

> Can we reliably convert messy third-party API knowledge into a structured
> capability graph that an AI planner can use to generate a valid integration
> workflow?

The answer, with the caveats in section 16: yes for machine-readable specs,
partially for prose.

---

## 2. Current Architecture

The repository already contained a Next.js 15 / React 19 / TypeScript app with a
hand-authored "knowledge pack" of 24 `EndpointSpec` objects, a lexical + embedding
retrieval path, an LLM planner producing an endpoint-level workflow, and a
deterministic mock execution engine. Vitest for tests, Zod for schemas, Ajv for
JSON Schema validation, the Vercel AI Gateway for all model access, and no
database.

Day 1 did not replace that app. It added a capability layer *beside* it:

```text
src/
  knowledge/          canonical model: provider, api version, capability,
                      implementation, schema, store, graph
                      (plus the pre-existing endpoint pack, untouched)
  ingestion/          fetcher, parsers, normalizer, validator, builder,
                      indexer, cache, pipeline, provider registry, sources
  retrieval/          capability documents, embeddings, search, ranking
  planner/            intent, prompt, planner, validator
  models/             model roles (planner / extraction / embedding / reranker)
  generated/          capability-store.json, capability-embeddings.json,
                      ingestion-cache.json
  app/api/            workflow/plan, capabilities (new); plan, execute (existing)
  components/console/ the prompt console and API library UI
```

The pre-existing endpoint-level pipeline (`/api/plan`, `src/lib/llm`,
`src/lib/exec`, the three-pane workspace at `/workspace`) still works and still
passes its tests. It will be retired once the capability layer covers execution
too; deleting it on Day 1 would have removed the only working execution path in
the repo for no gain.

---

## 3. Core Concepts

### Provider

A vendor whose API we can call: Stripe, Gmail, Slack, ElevenLabs, HubSpot. Owns
one or more API versions and points at the documentation it was learned from.

### API Version

One version of one provider's API, pinned to the exact document it came from via
a SHA-256 `content_hash`. Every capability belongs to a `(provider, api_version)`
pair, so no statement about what an API can do is ever made without saying which
version of that API.

### Capability

Something the system can *do*, stated independently of how it is invoked:
`stripe.create_checkout_session`, `gmail.send_message`,
`stripe.payment_intent_succeeded`. Carries inputs, outputs, category,
authentication shape, permissions, rate limits, idempotency, side effects,
provenance, confidence and a verification date.

Capabilities are either `action` (we invoke it) or `event` (the provider emits
it at us). Events can only ever start a workflow.

### Implementation

How a capability is actually called: protocol, method, endpoint, path
parameters, headers, request schema, response schema. One capability may have
many implementations — REST today, MCP or A2A later — which is why `protocol`
is a field rather than an assumption.

### Workflow

A linear, ordered set of steps plus the mappings that wire them together, with a
declared execution mode. Proposed by a model, admitted only by the validator.

### Workflow Step

One capability invocation in a workflow, addressed by a positional id
(`step_1`, `step_2`, …) so mappings can reference it unambiguously even when the
same capability appears twice.

---

## 4. System Architecture

```text
                    ┌──────────────────────────────────────────┐
  documentation ───▶│              INGESTION                    │
  (OpenAPI, prose)  │  fetch → parse → normalize → validate →   │
                    │  build → index                            │
                    └───────────────────┬──────────────────────┘
                                        │  capability-store.json
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │           CAPABILITY GRAPH                │
                    │  provider → version → capability →        │
                    │  implementation → schema fields           │
                    │  + derived produces/consumes links        │
                    └───────────────────┬──────────────────────┘
                                        │
       user request ──▶ intent ──▶ ┌────▼─────┐ ──▶ candidates ──▶ ┌─────────┐
                       (regex)     │RETRIEVAL │                     │ PLANNER │
                                   │ embed or │                     │  (LLM)  │
                                   │ lexical  │                     └────┬────┘
                                   └──────────┘                          │
                                                                    proposed plan
                                                                          │
                                                                    ┌─────▼─────┐
                                                                    │ VALIDATOR │
                                                                    │(no model) │
                                                                    └─────┬─────┘
                                                                          │
                                                              valid / rejected + reasons
```

One model call per planning request (the planner), plus one embedding call when
the embedding index is present. Everything else is deterministic.

---

## 5. Ingestion Architecture

```text
DocumentSource → Fetcher → Parser → Normalizer → Validator → Capability Builder → Indexer
```

Each stage is provider-independent. The only file holding provider-specific
knowledge is `src/ingestion/sources/index.ts`, the registry: where the document
lives, which version it describes, which environment variable holds that
provider's credential (the *name*, never the value), and the facts documentation
reliably fails to state machine-readably (provider-wide rate limits, idempotency
mechanism).

`ingest(provider)` is `ingestProvider(seed, context)`; `npm run ingest` runs it
for every seed.

### Path A — OpenAPI (primary)

```text
OpenAPI 3.0/3.1 → deterministic parser → canonical model
```

Extracts paths, methods, parameters (path/query/header), request and response
schemas with `$ref` and `allOf` inlined, security schemes and scopes, versions,
descriptions and examples, plus OpenAPI 3.1 `webhooks` (which is where event
capabilities come from). No model is involved and none can improve on it.

Capability names are derived deterministically in precedence order:
`x-integrelli-capability` pin → RPC-style dotted path (`/chat.postMessage` →
`chat_post_message`) → `<verb>_<resource>` from method and path shape
(`POST /v1/checkout/sessions` → `create_checkout_session`) → `operationId` as a
last resort. `operationId` is last because real specs use machine-generated ids
(`PostCheckoutSessions`) that retrieve badly.

### Path B — Documentation

```text
markdown → chunk by heading → extract → validate → canonical model
```

Chunking, draft assembly and validation are deterministic and shared with path
A. Only extraction *inside* a chunk is model-assisted, and its output is
constrained by `LlmCapabilityDraftSchema` — the model fills a fixed schema and
cannot introduce free-form structure. Transport facts it cannot know reliably
(base URL, protocol, credential env var, provider-wide limits) are supplied by
the registry, not the model.

There are two extractors behind one interface: the LLM extractor
(`extractWithLlm`) and a deterministic heuristic extractor (`extractHeuristic`)
that reads the common "heading + method line + parameter table" documentation
shape. The pipeline prefers the LLM when a key is configured and falls back to
the heuristic otherwise.

---

## 6. Capability Graph

```text
Provider ──has_version──▶ ApiVersion ──exposes──▶ Capability ──implemented_by──▶ Implementation
                                                       │
                                            consumes / produces
                                                       ▼
                                                 schema fields
```

Plus derived links between capabilities:

```text
stripe.payment_intent_succeeded
        │ produces
        ▼
data.object.receipt_email  (semantic type: email)
        │ can_feed
        ▼
hubspot.create_contact.properties.email
```

`can_feed` edges are derived deterministically from *semantic types*, not names.
A semantic type is a meaning label (`email`, `url`, `phone`, `currency_amount`,
`currency_code`, `identifier`, `timestamp`, …) inferred from a field's JSON
Schema `format` first and its name segments second. Only specific semantic types
produce edges: linking on `text` or `json` would connect nearly everything to
everything and carry no planning value.

Current graph: 222 nodes, 536 edges, of which 319 are `can_feed`.

---

## 7. Retrieval Architecture

```text
request → intent clauses → per-clause search → rank → provider floor → top N → planner
```

Embeddings are built **per capability**, never per documentation page. The
embedded document states the capability, provider, kind, category, description,
inputs, outputs and side effect — inputs and outputs included because
natural-language requests describe data as often as they describe verbs.

Retrieval runs once per intent clause plus once for the whole sentence. "When a
Stripe payment succeeds, send an email through Gmail" is two searches; one
blended query returns payment capabilities twice and email capabilities not at
all.

Every result carries `capability_id`, `similarity_score`, `rank_score`,
`provider`, `api_version`, `confidence`, `last_verified` and
`retrieval_method`. Similarity and confidence are reported separately and never
merged in the output:

- **similarity** — how much this looks like what was asked for.
- **confidence** — how much we believe this record is accurate.

A capability can score 0.9 on the first and 0.55 on the second. The planner and
the UI both see both numbers.

`rank_score` blends 0.75 × normalised similarity + 0.15 × confidence + 0.10 ×
provider-mentioned. It is an *ordering* device only; the raw similarity survives
alongside it.

The reranker slot exists in the model registry and is currently `none` —
reranking today is the deterministic blend above.

---

## 8. Planner Architecture

The planner receives the user intent, the retrieved candidates with their
metadata, and the input/output schemas of those candidates — never the whole
registry. It also receives the `can_feed` links the graph already knows are
type-compatible, because handing a model the legal moves is cheaper and more
accurate than letting it guess and rejecting the result.

It returns:

```json
{
  "execution_mode": "deterministic",
  "name": "Email a receipt when a payment succeeds",
  "description": "…",
  "steps": [
    { "id": "step_1", "capability": "stripe.payment_intent_succeeded", "purpose": "Detect the successful payment." },
    { "id": "step_2", "capability": "gmail.send_message", "purpose": "Send the confirmation email." }
  ],
  "mappings": [
    { "source": "literal:me", "destination": "step_2.userId" },
    { "source": "step_1.data.object.receipt_email", "destination": "step_2.raw", "transform": "rfc822_base64url" }
  ]
}
```

The planner proposes. The validator decides:

```text
LLM plan → Zod schema → capability existence → step ordering and event position
        → mapping resolution → field existence → type compatibility
        → required-input coverage → valid / rejected
```

Rejected outright: unknown capabilities, unknown fields, references to a later
step, self-references, events after step 1, semantically incompatible mappings,
required inputs nothing supplies, unsupported execution modes, malformed
structure. Warned, not rejected: coercion without a declared transform, use of a
low-confidence capability, use of a capability that was never retrieved.

The planner holds no credentials and calls no provider API. Execution is out of
scope today.

---

## 9. Data Model

```text
Provider                     ApiVersion
├── id                       ├── id                (provider@version)
├── name                     ├── provider_id
├── documentation_source     ├── version
└── versions[]               ├── status            (stable|beta|deprecated)
                             ├── source
                             ├── content_hash      (sha256 of raw document)
                             └── last_verified

Capability                              Implementation
├── id            (provider.name)       ├── id            (capability#protocol)
├── provider_id                         ├── capability_id
├── api_version_id                      ├── protocol      (rest|webhook|graphql|mcp|a2a)
├── kind          (action|event)        ├── method
├── name                                ├── endpoint
├── description                         ├── path_parameters[]
├── category                            ├── headers
├── inputs[]      (path,type,required,  ├── request_schema
│                  semantic_type,       └── response_schema
│                  location)
├── outputs[]     (same, no location)
├── authentication (kind, param name,
│                   env var NAME)
├── permissions[]
├── rate_limits
├── idempotency
├── side_effects
├── source        (document, pointer,
│                  extractor, model)
├── confidence    (0..1)
└── last_verified
```

Persisted records use `snake_case`; the surrounding TypeScript stays
`camelCase`.

> **Decision:** Model field naming.
> **Context:** The repo is camelCase TypeScript; the canonical model is a
> persisted wire format read by scripts, an API and the UI.
> **Options considered:** camelCase everywhere; snake_case for persisted records only.
> **Decision:** snake_case for canonical-model records and generated JSON, camelCase for functions and local types.
> **Reason:** The store is data, not app code; snake_case makes the boundary between "record" and "code" visible at a glance and matches the JSON most API documentation uses.
> **Trade-offs:** Two conventions in one repo; occasional friction at the boundary.
> **Revisit when:** The store moves into a database with a generated client that dictates naming.

---

## 10. AI Boundaries

Where models are used, and where they are deliberately not:

| Stage | Model? | Why |
|---|---|---|
| OpenAPI parsing | No | The document already states it machine-readably. |
| Documentation extraction | Yes, schema-constrained | Prose has no machine-readable structure. |
| Capability naming, categorisation, semantic typing | No | Deterministic rules, and they must be stable across runs. |
| Confidence scoring | No | A model scoring its own output is not evidence. |
| Intent extraction | No | Clause splitting and provider detection are string work. |
| Embedding | Yes | It is the retrieval mechanism. |
| Ranking / reranking | No (today) | The deterministic blend is testable offline. |
| Planning | Yes | Genuinely requires reasoning over alternatives. |
| Plan validation | No | Validity is a fact about the graph, not an opinion. |
| Execution | n/a | Out of scope today; will be deterministic. |

**Credentials never enter this system.** The registry stores environment
variable *names*. The ingestion pipeline never reads their values. Capability
records store `env_var_name`, never a secret. The planner prompt does not
include authentication details at all. The `/api/capabilities` response omits
them. A test asserts the serialized store matches no known credential pattern
(`sk_live_`, `sk_test_`, `xoxb-`, Google API keys).

> **Decision:** Model roles rather than a hardcoded provider.
> **Context:** Four different jobs need models, with very different cost and capability requirements, on a machine that cannot host a large local model.
> **Options considered:** One model id for everything; per-call model arguments; a role registry.
> **Decision:** A role registry (`planner`, `extraction`, `embedding`, `reranker`), each independently overridable by environment variable, all resolved as plain `provider/model` strings through the Vercel AI Gateway.
> **Reason:** Planning is the only job that needs a frontier model. Extraction is narrow and schema-constrained, so a cheap model suffices. Swapping a role to a local or cheaper model becomes a config change.
> **Trade-offs:** A stored artefact produced by one model can be invalidated by a role change, so the model id has to be part of every cache key.
> **Revisit when:** A local model is worth running for extraction, or the reranker slot gets a real implementation.

---

## 11. Caching Strategy

Implemented today:

| Cache | Key | Effect on a hit |
|---|---|---|
| Document content | `source_id` + `content_hash` + extractor signature | Whole provider skipped: no parse, no LLM, no re-embed. |
| Capability records | carried forward from the previous store on a content-hash hit | No re-normalisation, no re-validation. |
| Embeddings | `capability_id` + document hash + embedding model + document version | That vector is copied forward; only changed capabilities are re-embedded. |

The extractor signature is `openapi`, `markdown-heuristic`, or
`llm:<model id>` — swapping the extraction model invalidates everything that
model produced, which a naive content hash would not.

Designed, not implemented: intent → capability cache, workflow template cache,
planner result cache. All three would need the same invalidation inputs
(provider, API version, content hash, model version) and would each need to
observe capability changes. A cached plan must never survive a change to a
capability it references — that is exactly the failure mode this architecture
exists to prevent, so these caches are deliberately not shipped before the
invalidation path is real.

> **Decision:** Storage engine for the capability graph.
> **Context:** The canonical model is highly structured and semantic retrieval is required. PostgreSQL + pgvector is the natural production answer. The repository has no database, the target machine is an M2 with 8 GB, and Day 1 is about proving the knowledge layer.
> **Options considered:** PostgreSQL + pgvector; SQLite + sqlite-vec; committed JSON artefacts.
> **Decision:** Committed JSON artefacts (`capability-store.json`, `capability-embeddings.json`, `ingestion-cache.json`), validated by Zod on load, with an indexer stage that is the only writer.
> **Reason:** At 19 capabilities the entire graph is a few hundred kilobytes and cosine over 19 vectors is free. It keeps `next build` and the whole test suite offline and deterministic, and it makes every ingestion diff reviewable in git — which on Day 1 is worth more than query performance.
> **Trade-offs:** No concurrent writers, no partial loads, no SQL, no ANN index. Loading is all-or-nothing and the JSON is read into memory whole.
> **Revisit when:** Capabilities pass roughly 2,000, or the embedding file passes ~50 MB, or ingestion needs to run continuously rather than as a build step. The store interface (`loadStore`) is the seam where a database goes.

> **Decision:** Two extractors on the documentation path.
> **Context:** Path B needs an LLM for real-world prose, but ingestion that requires an API key cannot run in CI and cannot be tested deterministically.
> **Options considered:** LLM only; heuristic only; both behind one interface.
> **Decision:** Both, producing the same validated draft shape, LLM preferred when a key is configured.
> **Reason:** Ingestion and the full test suite run offline with zero LLM calls, while the LLM path remains the real answer for documents the heuristic cannot read.
> **Trade-offs:** Two code paths with different accuracy profiles feeding one graph — mitigated by recording the extractor in provenance and scoring confidence differently per extractor. It also means the committed store was produced by the weaker extractor (see section 16).
> **Revisit when:** The LLM path has been measured against the heuristic on the same documents.

---

## 12. Validation Strategy

Two independent validation layers.

**Ingestion validation** — every capability, from either path, faces the same
eight checks plus a ninth when a machine-readable document is available:

```text
✓ endpoint exists              ✓ response schema valid
✓ HTTP method exists           ✓ authentication identified
✓ required parameters found    ✓ API version identified
✓ request schema valid         ✓ source location recorded
✓ cross-checked against OpenAPI (when one exists for that provider)
```

Five of these are *hard*: endpoint, method, API version, source location,
request schema. Failing one drops the capability. A record we cannot address or
call is not partially useful; it is noise the planner would trip over.

Confidence starts from the extractor (`openapi` 0.95, `llm` 0.65,
`markdown-heuristic` 0.55), loses 0.1 per failed soft check, gains 0.25 when
cross-checked against OpenAPI and matched, loses 0.1 when cross-checked and
contradicted, and loses 0.05 with no response schema.

**Plan validation** — described in section 8. No model involved.

---

## 13. Design Decisions

> **Decision:** Capability separated from implementation.
> **Context:** The planner needs to reason about what can be done; the executor needs to know how to call it.
> **Options considered:** One record per endpoint (the pre-existing design); capability and implementation as separate records.
> **Decision:** Separate, joined by `capability_id`, with `protocol` on the implementation.
> **Reason:** It makes "the same capability over MCP or A2A" an added row rather than a schema migration, and it keeps transport details out of the planner prompt where they only add tokens and error surface.
> **Trade-offs:** One more join and one more id to keep consistent; today every capability has exactly one implementation, so the abstraction is unproven under its intended load.
> **Revisit when:** A second protocol lands, which is the first real test of the split.

> **Decision:** Deterministic capability naming from method and path.
> **Context:** `operationId` in real specs is often machine-generated (`PostCheckoutSessions`) or namespaced (`gmail.users.messages.send`), and both retrieve badly.
> **Options considered:** Trust `operationId`; ask an LLM to name capabilities; derive from method and path.
> **Decision:** Derive, with a documented pin (`x-integrelli-capability`) taking precedence and `operationId` as the last fallback.
> **Reason:** Names are part of the retrieval surface and part of every plan; they must be stable across runs and identical on every machine. An LLM naming step would be neither.
> **Trade-offs:** The derivation rules (singularisation, generic-segment stripping, action-verb tails) are heuristics tuned on five providers and will produce an awkward name eventually. The pin exists for exactly that case.
> **Revisit when:** A provider's paths produce names that lose golden queries.

> **Decision:** Intent extraction without a model.
> **Context:** The request has to be split into clauses and scanned for provider names before retrieval.
> **Options considered:** An LLM intent-extraction call; regex clause splitting plus provider-alias matching.
> **Decision:** Deterministic.
> **Reason:** It halves the per-request model cost, removes a failure mode, and is testable offline. Provider aliases come from the store, so a newly ingested provider becomes detectable without a code change.
> **Trade-offs:** The splitter over-splits on "and" inside a single clause. Retrieval is a union across clauses, so over-splitting costs candidate slots rather than correctness — but it does cost them.
> **Revisit when:** Golden queries start failing because of clause splitting rather than scoring.

> **Decision:** Semantic types as a deterministic layer over JSON types.
> **Context:** Type compatibility alone permits writing an email address into a phone field; both are strings.
> **Options considered:** JSON types only; an LLM compatibility judgement per mapping; deterministic semantic types.
> **Decision:** Infer a semantic type per field from `format` first, then name segments, and check it before the JSON type.
> **Reason:** It is what makes `can_feed` edges meaningful and what lets the validator reject a plausible-looking but wrong mapping, at zero marginal cost per request.
> **Trade-offs:** Name-based inference is wrong sometimes (see section 15), and a wrong semantic type can reject a legitimate mapping — a false negative in a validator that is supposed to be trustworthy.
> **Revisit when:** A real plan is rejected because of a mis-typed field.

---

## 14. Open Questions

1. **Transforms.** `gmail.send_message` requires `raw`: a base64url-encoded RFC
   2822 message. Mapping an email address into it needs a real transformation.
   The transform *registry* exists and the validator checks names against it,
   but no transform is implemented. Is a transform library the right shape, or
   should it be a composed capability (`gmail.send_simple_email` built on
   `gmail.send_message`)?
2. **Provider fan-out.** How much does ingestion accuracy degrade at 50
   providers of genuinely messy HTML documentation, rather than 5 curated ones?
3. **Confidence calibration.** The constants in section 12 are asserted, not
   measured. What would it take to calibrate them against observed extraction
   error?
4. **Graph density.** `can_feed` is O(outputs × inputs) within a semantic type.
   19 capabilities already produce 319 edges. At what size does this need
   indexing rather than derivation on load?
5. **Version drift.** When Stripe ships a new API version, what should happen to
   workflows referencing the old one — automatic migration, a diff report, or a
   hard failure?

---

## 15. Known Technical Risks

1. **The seeded documents are trimmed local mirrors, not the upstream specs.**
   The real Stripe OpenAPI document is several megabytes and uses `oneOf` and
   `anyOf` heavily. The parser inlines `$ref` and `allOf` only.
2. **The heuristic extractor reads the shape our own fixtures use.** Real
   documentation is HTML with inconsistent tables. On such input the heuristic
   will return null and the pipeline will have to fall back to the LLM path.
3. **Semantic typing is name-based and imperfect.** `data.object.customer` is a
   Stripe customer id but types as `text`, so it produces no `can_feed` edge.
4. **Cross-checking exists for one provider.** ElevenLabs is the only seed with
   a machine-readable document to contradict its prose. HubSpot's capabilities
   sit at 0.55 confidence with nothing to check them against.
5. **Rate limits and idempotency mostly come from the registry, hand-entered.**
   They are ingested-looking data that was not, in fact, extracted.
6. **The graph is loaded whole into memory on first access** and cached for the
   process lifetime. Fine at 19 capabilities; not a plan.
7. **No provider is versioned twice.** The `(provider, version)` split is
   modelled and unexercised.

---

## 16. Day 1 Review

### Self-review

**Ingestion**

- *Is OpenAPI parsed deterministically?* Yes. `src/ingestion/parser/openapi.ts`
  makes no model call, and a test asserts two parses of the same document
  produce byte-identical drafts via a stable hash.
- *Where is LLM extraction actually required?* Only inside one documentation
  chunk on path B, and only to fill a fixed Zod schema. Nowhere else in
  ingestion.
- *Can ingestion be rerun safely?* Yes. It is idempotent: same inputs produce
  the same store, and a rerun with unchanged documents skips every provider
  (verified — the second run reported `skipped` for all five with 0 LLM calls).
- *Can changed documentation be detected?* Yes, by SHA-256 of the raw document,
  combined with the extractor signature so a model swap also invalidates.
- *How do we know extracted information is correct?* We partly do not, and the
  system says so rather than pretending. Nine checks gate admission, five of
  them fatal; confidence encodes extractor trust; cross-checking against a
  machine-readable document raises or lowers it. What is missing is
  ground-truth: nothing verifies a capability by *calling* it.

**Capability graph**

- *Is capability separated from implementation?* Yes, as separate records joined
  by `capability_id`.
- *Can one capability have multiple implementations?* The model and the store
  index support it (`implementationsByCapability` is a list). No capability
  currently has two, so it is untested in practice.
- *Can the model support REST/MCP/A2A later?* `protocol` is an enum already
  containing `rest`, `webhook`, `graphql`, `mcp`, `a2a`, and events already use
  a non-REST protocol, so the second protocol is real rather than hypothetical.
  MCP and A2A would still need their own parsers.

**Retrieval**

- *Are embeddings generated at the correct granularity?* Yes — one document per
  capability, built by `buildCapabilityDocument`, never per page.
- *Are stale embeddings invalidated?* Yes, three ways: document hash per
  capability, embedding model id, and a document-version tag for when the
  document format itself changes.
- *Is semantic similarity being confused with correctness?* No. They are
  separate fields end to end — through ranking, through the API response,
  through the planner prompt, and in the UI table.

**Planner**

- *Does the LLM only propose?* Yes. Its output is a Zod-validated object that
  the validator then accepts or rejects; nothing downstream trusts it.
- *Is the plan deterministic and schema-validatable?* The plan *format* is fully
  schema-validated and the validation is deterministic. Generation is not
  deterministic and is not claimed to be.
- *Can the planner operate without seeing the entire API corpus?* Yes — it sees
  at most 14 candidates out of the corpus, plus the compatible wirings among
  them.

**Cost**

- *Are repeated LLM calls avoided?* Yes. Ingestion made 0 LLM calls across all
  five providers. Planning is one call, with a second only when the first fails
  schema validation outright.
- *Are embeddings cached?* Yes, per capability, and only changed capabilities
  are re-embedded.
- *Are unchanged documents skipped?* Yes, before parsing.

**Reliability**

- *What happens when ingestion partially fails?* Failure is scoped to the
  provider. A failed fetch records `status: failed` for that provider and the
  run continues; other providers still produce a store.
- *What happens when one capability fails validation?* It is dropped with a
  recorded error issue; the rest of the provider is unaffected.
- *Can bad documentation pollute the knowledge base?* It can degrade it, not
  silently. Hard checks reject unusable records, provenance records which
  document and extractor produced each fact, confidence separates prose from
  spec, and the planner warns when a plan leans on a low-confidence capability.
  What it cannot catch is documentation that is well-formed and wrong.

**Security**

- *Are credentials completely outside the ingestion/planning layer?* Yes. The
  registry holds env var *names*; no stage reads their values.
- *Are secrets excluded from prompts, embeddings, and logs?* Yes. The planner
  prompt contains no auth block; the embedding document contains no auth block;
  `/api/capabilities` omits auth entirely; a test asserts the serialized store
  matches no known credential pattern. Provider errors are logged server-side
  and never returned to the client.

### What was implemented

Canonical model (provider, API version, capability, implementation, schema);
provider-independent ingestion pipeline with both paths; content-hash caching;
ingestion validation with confidence and provenance; capability graph with
derived produce/consume links; capability-level embeddings with per-capability
invalidation and a lexical fallback; retrieval with separated similarity and
confidence metadata; deterministic intent extraction; LLM planner; deterministic
plan validator; `POST /api/workflow/plan`; `GET /api/capabilities`; a rebuilt
console UI and an API library view; 15 golden queries and 75 new tests.

Seeded: Stripe (8 capabilities including 2 webhook events), Gmail (4), Slack
(3), ElevenLabs (2), HubSpot (2). 19 capabilities, 19 implementations, 58
inputs, 116 outputs, 0 ingestion errors.

### What assumptions proved correct

- Deterministic naming from method and path beats `operationId`. Every golden
  query resolves to a derived name.
- Capability-level embedding granularity is right; the golden suite passes on
  the *lexical* scorer alone, which suggests the documents carry enough signal.
- Separating similarity from confidence was worth it immediately — HubSpot
  capabilities rank well on similarity and are visibly less trustworthy.
- Chunk → schema-constrained extract → validate → normalize produces usable
  records from prose. ElevenLabs and HubSpot came through the prose path and
  are usable capabilities.
- Content hashing paid for itself on the second run.

### What assumptions were wrong

- **Substring hint matching for semantic types was wrong** and shipped broken
  first: `status` matched the `at` hint and typed as `timestamp`, as did
  `latest_charge`. Fixed by segment-wise matching. It was caught by inspecting
  output, not by a test — the tests were written after.
- **"OpenAPI is the primary path" understates how much registry knowledge is
  needed.** Rate limits, idempotency mechanisms and credential env vars are not
  in the specs. A meaningful share of each capability record is hand-entered
  configuration, not ingested fact.
- **One capability, one implementation** in practice, so the abstraction that
  motivates the whole design is currently carrying no weight.
- **The planner was assumed to be the risky component.** The riskier one is
  extraction: the planner is bounded by a validator, extraction is bounded only
  by our own checks.

### Retrieval accuracy

15 golden queries across 5 providers, run on the lexical path with no network:
15/15 within their stated rank. 11 at rank 1. The weakest is "detect a
successful payment" at rank 3, behind `create_payment_link` and
`get_payment_intent` — the event's description does not use the word "detect",
which no amount of scoring will fix; the document text should.

This number is optimistic and should be read as such: the queries were written
by the same person who wrote the capability descriptions, against a 19-capability
corpus where most queries have exactly one plausible answer. It is a regression
detector, not a measurement of accuracy.

The embedding path is implemented and **was not exercised** — no
`AI_GATEWAY_API_KEY` is configured, so `capability-embeddings.json` is empty and
every measured number above comes from the lexical fallback.

### Ingestion accuracy

19/19 seeded capabilities admitted, 0 errors, 0 warnings. Spot-checked by hand
against the source documents: names, methods, paths, required flags, auth kinds
and event payload shapes are correct for all 19.

That is accuracy against *our own trimmed fixtures*, which is the weakest
possible version of this claim. Ingestion has never been run against a real
upstream specification.

### Planner accuracy

**Unmeasured.** No plan has been generated by a live model, because no gateway
key is configured. The planner path is typed, unit-tested at its boundaries, and
returns a clean `planner_unavailable` error, but its actual output quality is
unknown.

What *is* verified end-to-end without a model: the request "When a Stripe
payment succeeds, send an email through Gmail" retrieves both
`stripe.payment_intent_succeeded` and `gmail.send_message` into the candidate
set, and the corresponding hand-written plan passes every validator check —
capabilities exist, schemas exist, mappings resolve and type-check, required
inputs are covered, execution mode is supported. So the Day 1 definition of done
holds for every link in the chain except the generative step itself, which is
the one link that cannot be verified offline.

### LLM calls per request

- Ingestion, current configuration: **0** per provider (OpenAPI deterministic;
  prose falls back to the heuristic without a key). With a key: 1 per
  documentation chunk on first ingest, 0 on unchanged reruns.
- Planning: **1** embedding call (when the index exists) + **1** planner call.
  A second planner call only if the first returns schema-invalid output.

### Known bottlenecks

- `loadStore()` parses and validates the whole store on first access.
- `buildGraph()` derives all `can_feed` edges eagerly; it is O(n²) in
  capabilities within a semantic type.
- Lexical scoring rebuilds the TF-IDF index on every query.
- `embedMany` sends every changed capability in one request with no batching
  limit.

None matter at 19 capabilities. All matter at 2,000.

### Technical debt

- Two knowledge models coexist: the new capability graph and the original
  `EndpointSpec` pack with its own retrieval, planner and execution engine.
- The transform registry names transformations nothing implements.
- `oneOf`/`anyOf` are dropped by the dereferencer.
- Provider aliases for intent detection are a hardcoded map for the three cases
  the store's own names miss.
- The console's recent-workflows list is `localStorage`; there is no workflow
  persistence.
- Golden query expectations are hand-authored and correlated with the
  descriptions they match.

### Security concerns

- No credential ever enters ingestion, embeddings, prompts, logs or the store —
  verified by test.
- Ingested documentation is untrusted input that reaches an LLM prompt on path
  B. A crafted document could attempt prompt injection. The schema-constrained
  output bounds the blast radius (the model can only emit a capability draft),
  but a successful injection could still plant a plausible-looking capability
  pointing at an attacker's endpoint. There is no allowlist on ingested
  endpoints today. **This is the most serious open security issue.**
- The HTTP fetcher will fetch any URL a registry entry names. Day 1 seeds are
  local files, so it is unexercised, but there is no SSRF guard.
- No authentication on any route; the app is local-only today.

### Scalability concerns

Storage, graph derivation and retrieval all assume the corpus fits in memory and
in a git diff. The store interface is the seam where PostgreSQL + pgvector goes.
The trigger is roughly 2,000 capabilities or a 50 MB embedding file.

### Decisions to revisit

1. Committed JSON as the store — at the scale threshold above.
2. Confidence constants — once there is measured extraction error to calibrate
   against.
3. Eager `can_feed` derivation — when graph size makes load time visible.
4. Deterministic intent extraction — if clause splitting starts losing
   candidates.
5. Keeping the legacy endpoint pack — once capability-level execution exists.

### Day 2 recommendations

1. **Configure a gateway key and measure what Day 1 could not**: real LLM
   extraction on the prose providers, real embeddings, real planner output on
   the golden set. Three of this document's accuracy sections are currently
   blank for the same reason.
2. **Ingest one real upstream specification end to end** (Stripe's is the
   hardest and the most useful). Expect `oneOf`/`anyOf` work and expect the
   depth caps to bite.
3. **Compare the two extractors on the same documents** and calibrate the
   confidence constants against the disagreement.
4. **Implement the transform registry**, starting with `rfc822_base64url`, which
   the acceptance workflow already depends on.
5. **Put an allowlist on ingested endpoint hosts** so a poisoned document cannot
   introduce a capability pointing somewhere else.
6. **Only then start the execution engine**, against the capability model rather
   than the legacy endpoint pack.

---

## 17. Future Architecture

```text
                    ┌─────────────────────────────────────┐
   many providers ─▶│  scheduled ingestion workers        │
   (HTML, OpenAPI,  │  change detection → partial re-parse │
    MCP manifests)  └───────────────┬─────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────┐
                    │  PostgreSQL + pgvector               │
                    │  capabilities, implementations,      │
                    │  versions, embeddings, edges         │
                    └───────────────┬─────────────────────┘
                                    ▼
              retrieval (ANN + filters) ─▶ planner ─▶ validator
                                    │                      │
                                    │                 valid plan
                                    ▼                      ▼
                        capability composition      execution engine
                        (transforms, sub-workflows)  (retries, rate limits,
                                                      credential vault,
                                                      health scoring)
```

The pieces Day 1 deliberately did not build — execution, credential management,
rate-limit monitoring, health scores — all hang off a validated plan, which is
why the plan contract and its validator were the things worth getting right
first.
