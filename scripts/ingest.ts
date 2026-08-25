import { ingestAll } from '@/ingestion/pipeline';
import { modelsAvailable } from '@/models';
import { buildEmbeddingIndex } from '@/retrieval/embeddings';

/**
 * `npm run ingest` — runs the full ingestion pipeline for every seeded provider
 * and refreshes the embedding index.
 *
 * Flags:
 *   --force        re-parse and re-extract even when content hashes match
 *   --heuristic    skip the LLM extractor on the documentation path
 *   --only=a,b     restrict the run to these provider ids
 *   --no-embed     skip the embedding refresh
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const preferHeuristic = argv.includes('--heuristic');
  const skipEmbed = argv.includes('--no-embed');
  const only = argv
    .find((arg) => arg.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .filter(Boolean);

  const { store, results } = await ingestAll({ force, preferHeuristic, only });

  let totalLlmCalls = 0;
  for (const result of results) {
    totalLlmCalls += result.llm_calls;
    const errors = result.issues.filter((i) => i.severity === 'error').length;
    const warnings = result.issues.filter((i) => i.severity === 'warning').length;
    console.log(
      `${result.provider_id.padEnd(12)} ${result.status.padEnd(9)} ` +
        `${String(result.capability_count).padStart(2)} capabilities  ` +
        `${errors} errors  ${warnings} warnings  ${result.llm_calls} LLM calls`
    );
  }

  for (const issue of store.ingestion_issues) {
    console.log(`  [${issue.severity}] ${issue.provider_id}: ${issue.message}`);
  }

  console.log(
    `\n${store.capabilities.length} capabilities across ${store.providers.length} providers; ` +
      `${totalLlmCalls} LLM extraction calls this run.`
  );

  if (skipEmbed) {
    console.log('Embedding refresh skipped (--no-embed).');
    return;
  }

  if (!modelsAvailable()) {
    console.log(
      'AI_GATEWAY_API_KEY not set — embedding index left as is; retrieval will use the lexical scorer.'
    );
    return;
  }

  const embedResult = await buildEmbeddingIndex(store.capabilities);
  console.log(
    `Embeddings: ${embedResult.embedded} newly embedded, ${embedResult.reused} reused from cache, ` +
      `${embedResult.removed} dropped.`
  );
}

main().catch((err) => {
  console.error('Ingestion failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
