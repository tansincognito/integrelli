import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { embedMany } from 'ai';
import { ALL_ENDPOINTS } from '@/knowledge';
import { EMBEDDING_MODEL_ID } from '@/lib/retrieval/embed';
import { buildDocumentText, computeCorpusHash, type StaticEmbeddingIndexFile } from '@/lib/retrieval/index-loader';

const OUTPUT_PATH = path.resolve(process.cwd(), 'src/generated/embedding-index.json');

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      [
        'AI_GATEWAY_API_KEY is not set — cannot build real embeddings.',
        '',
        'Set AI_GATEWAY_API_KEY (see .env.example) and re-run `npm run embed`.',
        'The app does not require this to work: src/generated/embedding-index.json',
        'is already committed with "generated": false, which makes retrieval',
        'degrade to the lexical scorer (src/lib/retrieval/lexical.ts) at runtime.',
      ].join('\n')
    );
    process.exit(1);
  }

  console.log(`Embedding ${ALL_ENDPOINTS.length} endpoint docs with ${EMBEDDING_MODEL_ID}...`);

  const documentTexts = ALL_ENDPOINTS.map((spec) => buildDocumentText(spec));

  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL_ID,
    values: documentTexts,
  });

  const entries = ALL_ENDPOINTS.map((spec, i) => ({
    id: spec.id,
    documentText: documentTexts[i],
    embedding: embeddings[i],
  }));

  const file: StaticEmbeddingIndexFile = {
    model: EMBEDDING_MODEL_ID,
    dimensions: embeddings[0]?.length ?? 1536,
    builtAt: new Date().toISOString(),
    corpusHash: computeCorpusHash(ALL_ENDPOINTS),
    entries,
    generated: true,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(file, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${entries.length} embeddings to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Failed to build embeddings:', err instanceof Error ? err.message : err);
  process.exit(1);
});
