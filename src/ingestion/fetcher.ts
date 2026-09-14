import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentationSource } from '@/knowledge/provider';
import { sha256 } from './hash';
import type { FetchedDocument } from './types';

/**
 * Stage 1 of the pipeline. Turns a `DocumentationSource` into bytes plus a
 * content hash, and nothing else — no parsing, no provider knowledge.
 *
 * Two transports: local file (the Day 1 default, so ingestion is offline and
 * deterministic) and http(s) (so pointing a source at the upstream spec is a
 * one-field change, not a code change). See architecture.md section 5.
 */
export async function fetchDocument(source: DocumentationSource): Promise<FetchedDocument> {
  const content = isHttp(source.location)
    ? await fetchOverHttp(source.location)
    : await readFile(path.resolve(process.cwd(), source.location), 'utf-8');

  return {
    source,
    content,
    content_hash: sha256(content),
    fetched_at: new Date().toISOString(),
  };
}

function isHttp(location: string): boolean {
  return location.startsWith('http://') || location.startsWith('https://');
}

async function fetchOverHttp(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: 'application/json, text/markdown, text/plain, */*' } });
  if (!response.ok) {
    throw new Error(`fetchDocument: ${url} returned HTTP ${response.status}`);
  }
  return response.text();
}
