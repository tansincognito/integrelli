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
  llm_calls: number;
  error?: { code: string; message: string };
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
