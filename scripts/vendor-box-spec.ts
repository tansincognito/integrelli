/**
 * Curates Box's real, published OpenAPI document
 * (github.com/box/box-openapi) into
 * `src/ingestion/sources/openapi/box.json`. See vendor-stripe-spec.ts.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://raw.githubusercontent.com/box/box-openapi/main/openapi.json',
  operations: [
    { path: '/files/{file_id}', method: 'get' },
    { path: '/folders/{folder_id}/items', method: 'get' },
  ],
  outPath: 'src/ingestion/sources/openapi/box.json',
  title: 'Box API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
