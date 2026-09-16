/**
 * Wire shape of `POST /api/workflow/plan`, restated for the client.
 *
 * Deliberately a local declaration rather than an import from `@/planner`: the
 * console is a browser bundle and has no business pulling the planner, the
 * capability store, or the model layer into it.
 */
export interface PlanResponseBody {
  intent: {
    raw: string;
    clauses: Array<{ text: string; role: 'trigger' | 'action'; provider_hints: string[] }>;
    provider_hints: string[];
  };
  retrieval: {
    method: 'embedding' | 'lexical';
    candidates: Array<{
      capability_id: string;
      similarity_score: number;
      rank_score: number;
      provider: string;
      api_version: string;
      confidence: number;
      last_verified: string;
    }>;
  };
  plan: {
    execution_mode: string;
    name: string;
    description: string;
    steps: Array<{ id: string; capability: string; purpose: string }>;
    mappings: Array<{ source: string; destination: string; transform?: string }>;
  } | null;
  validation: {
    valid: boolean;
    errors: Array<{ code: string; message: string; step_id?: string }>;
    warnings: Array<{ code: string; message: string; step_id?: string }>;
  } | null;
  presented_steps: PresentedStep[] | null;
  risks: WorkflowRisk[];
  curl_script: string | null;
  llm_calls: number;
  plan_source: 'llm' | 'heuristic' | null;
  error?: { code: string; message: string };
}

/** Mirrors src/planner/present.ts's PresentedStep — the flow-chart view of a compiled plan. */
export interface PresentedStep {
  step_id: string;
  capability_id: string;
  provider_id: string;
  kind: 'action' | 'event';
  purpose: string;
  side_effect: string;
  confidence: number;
  authentication: { kind: string; env_var_name?: string; parameter_name?: string; scheme_description?: string };
  rate_limits: { requests?: number; window_seconds?: number; note?: string } | null;
  idempotency: { supported: boolean; mechanism?: string; key_location?: string };
  fields: PresentedField[];
  ready: boolean;
  missing_required_count: number;
}

export interface PresentedField {
  path: string;
  depth: number;
  required: boolean;
  type: string;
  semantic_type: string;
  location: string;
  status: 'mapped' | 'missing';
  mapping?: PresentedMapping;
  description?: string;
  format?: string;
  enum?: Array<string | number | boolean | null>;
}

export interface PresentedMapping {
  kind: 'literal' | 'field' | 'template' | 'implied';
  summary: string;
  raw: string;
  transform?: string;
  source_step_id?: string;
  source_path?: string;
  referenced_step_ids?: string[];
}

export interface WorkflowRisk {
  severity: 'high' | 'medium';
  code: 'retry_unsafe' | 'rate_limit_collision';
  step_id: string;
  message: string;
}

export interface CapabilityLibraryBody {
  built_at: string;
  providers: Array<{
    id: string;
    name: string;
    version: string;
    status: string;
    source_label: string;
    upstream_url?: string;
    capabilities: Array<{
      id: string;
      name: string;
      kind: 'action' | 'event';
      description: string;
      category: string;
      confidence: number;
      extractor: string;
      method: string | null;
      endpoint: string;
      input_count: number;
      output_count: number;
    }>;
  }>;
}
