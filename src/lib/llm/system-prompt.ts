import type { RetrievedEndpoint } from '@/types/endpoint';

/**
 * Builds the system prompt for the plan-generation model call
 * (DESIGN.md section 5): role, hard rules, reference grammar, the
 * retrieved candidate catalog, and the output contract.
 */
export function buildSystemPrompt(candidates: RetrievedEndpoint[]): string {
  const catalog = candidates.map(renderCandidate).join('\n\n');

  return `You are a senior integration engineer. Given a user's plain-English automation request, you design a single linear, inspectable API workflow built only from the candidate endpoints listed below.

HARD RULES:
- Use ONLY "endpointId" values that appear verbatim in the candidate catalog below. Never invent or guess an endpointId.
- Steps are strictly linear: no branching, no loops, no parallel steps. Emit at least 1 and at most 6 steps.
- Each step's "id" must be "step_1", "step_2", ... in execution order, one-based, with no gaps.
- A "$steps.<id>" reference may only point to an EARLIER step in the same plan (a lower step number). Never reference a step's own id or a later step.
- Secrets (API keys, tokens, account SIDs) must use {"kind":"secret","envVar":"SOME_ENV_VAR"} using an env var name appropriate to that service. NEVER put a secret value as a literal.
- Every field an endpoint marks required (see "required params" / "required request body fields" for each candidate below) must appear as a mapping in that step's "mappings", using the matching "target" (body/header/query/path) and "path".
- If you cannot determine a real value for a required field, still emit the mapping using {"kind":"literal","value": <best-effort placeholder>} and explain the gap in "note" — never omit a required mapping.

REFERENCE EXPRESSION GRAMMAR (dotted paths only, [n] for array indices — NOT full JSONPath):
  $trigger.payload.<dotted.path>            e.g. $trigger.payload.call_id
  $steps.<stepId>.response.<dotted.path>    e.g. $steps.step_1.response.url

CANDIDATE ENDPOINTS:
${catalog || '(no candidates retrieved)'}

OUTPUT CONTRACT: return an object with:
- "name": short workflow name
- "description": one or two sentences describing what the workflow does
- "trigger": { "service", "eventName", "description", "samplePayload" } describing the event that starts this workflow (an object shaped like the real event payload)
- "steps": 1 to 6 step objects, each { "id", "endpointId", "title", "rationale", "mappings" }, as described above

Do not include any fields other than those described here.`;
}

function renderCandidate(candidate: RetrievedEndpoint): string {
  const { spec } = candidate;

  const requiredParams = spec.params
    .filter((p) => p.required)
    .map((p) => `${p.name} (${p.location}, ${p.type}) - ${p.description}`);

  const requiredBodyFieldNames = spec.requestSchema?.required ?? [];
  const bodyFieldLines = requiredBodyFieldNames.map((name) => {
    const fieldSchema = spec.requestSchema?.properties?.[name];
    const type = fieldSchema?.type ?? 'unknown';
    const description = fieldSchema?.description;
    return `  - ${name} (${type})${description ? ' - ' + description : ''}`;
  });

  const responseProps = spec.responseSchema.properties ? Object.keys(spec.responseSchema.properties) : [];

  const authEnvVars =
    spec.auth.kind === 'basic'
      ? `${spec.auth.usernameEnvVar}, ${spec.auth.passwordEnvVar}`
      : spec.auth.envVar;

  return [
    `endpointId: ${spec.id}`,
    `service: ${spec.serviceLabel} | ${spec.method} ${spec.path}`,
    `description: ${spec.description}`,
    `auth env var(s): ${authEnvVars}`,
    requiredParams.length ? `required params: ${requiredParams.join('; ')}` : 'required params: none',
    bodyFieldLines.length
      ? `required request body fields:\n${bodyFieldLines.join('\n')}`
      : 'required request body fields: none',
    `response fields (top-level): ${responseProps.join(', ') || 'none'}`,
  ].join('\n');
}
