import { z } from 'zod';
import type { JsonSchemaNode } from './schema';

/**
 * How a capability is actually invoked. One capability may have several
 * implementations — a REST endpoint today, an MCP tool or an A2A skill later —
 * which is exactly why `protocol` is part of the record rather than assumed.
 */
export type Protocol = 'rest' | 'webhook' | 'graphql' | 'mcp' | 'a2a';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface Implementation {
  id: string;
  capability_id: string;
  protocol: Protocol;
  /** HTTP verb for rest/webhook; null for protocols without one. */
  method: HttpMethod | null;
  /** Full endpoint template, e.g. `https://api.stripe.com/v1/checkout/sessions`. */
  endpoint: string;
  /** Path template placeholders in `{name}` form, listed for the executor's benefit. */
  path_parameters: string[];
  /** Static headers required by the call. Values never contain secrets. */
  headers: Record<string, string>;
  request_schema: JsonSchemaNode | null;
  response_schema: JsonSchemaNode | null;
  /** Content type of the request body, when there is one. */
  request_content_type?: string;
}

const JsonSchemaNodeSchema: z.ZodType<JsonSchemaNode> = z.record(z.unknown()) as z.ZodType<JsonSchemaNode>;

export const ImplementationSchema = z.object({
  id: z.string().min(1),
  capability_id: z.string().min(1),
  protocol: z.enum(['rest', 'webhook', 'graphql', 'mcp', 'a2a']),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).nullable(),
  endpoint: z.string().min(1),
  path_parameters: z.array(z.string()),
  headers: z.record(z.string()),
  request_schema: JsonSchemaNodeSchema.nullable(),
  response_schema: JsonSchemaNodeSchema.nullable(),
  request_content_type: z.string().optional(),
});

export function implementationId(capabilityId: string, protocol: Protocol): string {
  return `${capabilityId}#${protocol}`;
}
