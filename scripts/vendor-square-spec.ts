/**
 * Curates Square's real, published OpenAPI document
 * (github.com/square/connect-api-specification) into
 * `src/ingestion/sources/openapi/square.json`. See vendor-stripe-spec.ts.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://raw.githubusercontent.com/square/connect-api-specification/master/api.json',
  operations: [
    { path: '/v2/payments', method: 'post' },
    { path: '/v2/customers', method: 'post' },
  ],
  outPath: 'src/ingestion/sources/openapi/square.json',
  title: 'Square API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
