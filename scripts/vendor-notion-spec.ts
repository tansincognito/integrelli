/**
 * Curates Notion's real, published OpenAPI document
 * (developers.notion.com/openapi.json) into
 * `src/ingestion/sources/openapi/notion.json`. See vendor-stripe-spec.ts.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://developers.notion.com/openapi.json',
  operations: [
    { path: '/v1/pages', method: 'post' },
    { path: '/v1/pages/{page_id}', method: 'get' },
    { path: '/v1/data_sources/{data_source_id}/query', method: 'post' },
  ],
  outPath: 'src/ingestion/sources/openapi/notion.json',
  title: 'Notion API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
