import type { Capability } from './capability';
import type { SemanticType } from './schema';
import { loadStore, type LoadedStore } from './store';

/**
 * The capability graph. Structural edges (provider → version → capability →
 * implementation → schema) come straight from the store; `can_feed` edges are
 * derived deterministically from semantic types and are what makes multi-step
 * planning possible:
 *
 *   stripe.create_payment_link --produces--> url
 *                                            |
 *                                       consumed by
 *                                            v
 *                                     gmail.send_message.body
 */

export type NodeKind = 'provider' | 'api_version' | 'capability' | 'implementation' | 'field';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
}

export type EdgeKind = 'has_version' | 'exposes' | 'implemented_by' | 'produces' | 'consumes' | 'can_feed';

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Only set on `can_feed`: why the two fields were linked. */
  semantic_type?: SemanticType;
}

export interface CapabilityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Semantic types specific enough to justify a `can_feed` edge. `text` and
 * `json` are excluded deliberately: they match nearly everything, so linking
 * on them would produce an O(n²) hairball with no planning value.
 */
const LINKABLE_SEMANTIC_TYPES: SemanticType[] = [
  'email', 'url', 'phone', 'identifier', 'currency_amount', 'currency_code', 'timestamp',
];

export function outputFieldNodeId(capabilityId: string, path: string): string {
  return `${capabilityId}#out:${path}`;
}

export function inputFieldNodeId(capabilityId: string, path: string): string {
  return `${capabilityId}#in:${path}`;
}

export function buildGraph(loaded: LoadedStore = loadStore()): CapabilityGraph {
  const { store } = loaded;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const provider of store.providers) {
    nodes.push({ id: provider.id, kind: 'provider', label: provider.name });
  }

  for (const version of store.api_versions) {
    nodes.push({ id: version.id, kind: 'api_version', label: `${version.provider_id} ${version.version}` });
    edges.push({ from: version.provider_id, to: version.id, kind: 'has_version' });
  }

  for (const capability of store.capabilities) {
    nodes.push({ id: capability.id, kind: 'capability', label: capability.name });
    edges.push({ from: capability.api_version_id, to: capability.id, kind: 'exposes' });

    for (const input of capability.inputs) {
      const id = inputFieldNodeId(capability.id, input.path);
      nodes.push({ id, kind: 'field', label: input.path });
      edges.push({ from: capability.id, to: id, kind: 'consumes' });
    }
    for (const output of capability.outputs) {
      const id = outputFieldNodeId(capability.id, output.path);
      nodes.push({ id, kind: 'field', label: output.path });
      edges.push({ from: capability.id, to: id, kind: 'produces' });
    }
  }

  for (const implementation of store.implementations) {
    nodes.push({
      id: implementation.id,
      kind: 'implementation',
      label: `${implementation.protocol} ${implementation.method ?? ''} ${implementation.endpoint}`.trim(),
    });
    edges.push({ from: implementation.capability_id, to: implementation.id, kind: 'implemented_by' });
  }

  edges.push(...deriveCanFeedEdges(store.capabilities));

  return { nodes, edges };
}

/** Output-field → input-field links between different capabilities that share a specific semantic type. */
export function deriveCanFeedEdges(capabilities: Capability[]): GraphEdge[] {
  const consumersBySemanticType = new Map<SemanticType, Array<{ capabilityId: string; path: string }>>();

  for (const capability of capabilities) {
    for (const input of capability.inputs) {
      if (!LINKABLE_SEMANTIC_TYPES.includes(input.semantic_type)) continue;
      const list = consumersBySemanticType.get(input.semantic_type) ?? [];
      list.push({ capabilityId: capability.id, path: input.path });
      consumersBySemanticType.set(input.semantic_type, list);
    }
  }

  const edges: GraphEdge[] = [];
  for (const capability of capabilities) {
    for (const output of capability.outputs) {
      if (!LINKABLE_SEMANTIC_TYPES.includes(output.semantic_type)) continue;
      for (const consumer of consumersBySemanticType.get(output.semantic_type) ?? []) {
        if (consumer.capabilityId === capability.id) continue;
        edges.push({
          from: outputFieldNodeId(capability.id, output.path),
          to: inputFieldNodeId(consumer.capabilityId, consumer.path),
          kind: 'can_feed',
          semantic_type: output.semantic_type,
        });
      }
    }
  }
  return edges;
}

export interface FeedLink {
  from_capability_id: string;
  from_path: string;
  to_capability_id: string;
  to_path: string;
  semantic_type: SemanticType;
}

/**
 * Which fields of `producerIds` can supply which inputs of `consumerId`.
 * Used to tell the planner what wiring is even possible before it proposes any.
 */
export function findFeedLinks(
  producerIds: string[],
  consumerId: string,
  loaded: LoadedStore = loadStore()
): FeedLink[] {
  const consumer = loaded.capabilitiesById.get(consumerId);
  if (!consumer) return [];

  const links: FeedLink[] = [];
  for (const producerId of producerIds) {
    const producer = loaded.capabilitiesById.get(producerId);
    if (!producer || producer.id === consumer.id) continue;

    for (const output of producer.outputs) {
      if (!LINKABLE_SEMANTIC_TYPES.includes(output.semantic_type)) continue;
      for (const input of consumer.inputs) {
        if (input.semantic_type !== output.semantic_type) continue;
        links.push({
          from_capability_id: producer.id,
          from_path: output.path,
          to_capability_id: consumer.id,
          to_path: input.path,
          semantic_type: output.semantic_type,
        });
      }
    }
  }
  return links;
}
