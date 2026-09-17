/**
 * Curates DocuSign's real, published Swagger 2.0 document
 * (github.com/docusign/eSign-OpenAPI-Specification) into
 * `src/ingestion/sources/openapi/docusign.json`, converted to OpenAPI 3
 * shape. See scripts/lib/swagger2-curator.ts.
 */

import { curateSwagger2 } from './lib/swagger2-curator';

curateSwagger2({
  specUrl: 'https://raw.githubusercontent.com/docusign/eSign-OpenAPI-Specification/master/esignature.rest.swagger-v2.1.json',
  operations: [
    { path: '/v2.1/accounts/{accountId}/envelopes', method: 'post' },
    { path: '/v2.1/accounts/{accountId}/envelopes/{envelopeId}', method: 'get' },
  ],
  outPath: 'src/ingestion/sources/openapi/docusign.json',
  title: 'DocuSign eSignature API (curated real subset)',
  // DocuSign's envelope/document/tabs object graph is the deepest and
  // widest of every provider curated here (recipients -> tabs -> per-tab-type
  // variants -> ...). The shared defaults (depth 4, 200 schemas) don't bound
  // it — real ingestion against them flattened into ~99,000 fields and OOM'd
  // the can_feed graph derivation (O(inputs x outputs) per semantic type,
  // architecture.md section 15 risk 6). A tighter cap here keeps this
  // provider's two operations real and demo-sized instead of pulling in the
  // whole envelope schema graph.
  maxDepth: 2,
  maxSchemas: 40,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
