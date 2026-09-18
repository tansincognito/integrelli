/**
 * Curates PagerDuty's real, published OpenAPI document
 * (github.com/PagerDuty/api-schema) into
 * `src/ingestion/sources/openapi/pagerduty.json`. See vendor-stripe-spec.ts.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json',
  operations: [
    { path: '/incidents', method: 'post' },
    { path: '/incidents/{id}', method: 'get' },
  ],
  outPath: 'src/ingestion/sources/openapi/pagerduty.json',
  title: 'PagerDuty API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
