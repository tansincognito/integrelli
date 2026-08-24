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
