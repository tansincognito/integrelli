/**
 * Curates ElevenLabs's real, published OpenAPI document (api.elevenlabs.io/openapi.json)
 * into `src/ingestion/sources/openapi/elevenlabs-partial.json` — the
 * *cross-check* document only (architecture.md section 6: it exists purely
 * to contradict a bad prose extraction, never to create a capability).
 *
 * `src/ingestion/sources/docs/elevenlabs.md` is left untouched on purpose:
 * it is a deliberate, labeled stand-in for ElevenLabs's prose docs (see its
 * own header comment), built specifically to exercise the documentation
 * ingestion path (chunk -> extract -> validate) on prose rather than a
 * machine-readable spec. Real docs are an HTML page with its own inconsistent
 * table shapes (architecture.md section 15, risk 2); scraping it would change
 * what this provider is testing, not just where its data comes from.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://api.elevenlabs.io/openapi.json',
  operations: [
    { path: '/v1/text-to-speech/{voice_id}', method: 'post' },
    { path: '/v1/voices', method: 'get' },
  ],
  outPath: 'src/ingestion/sources/openapi/elevenlabs-partial.json',
  title: 'ElevenLabs API (curated cross-check subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
