/**
 * Curates GitHub's real, published OpenAPI document
 * (github.com/github/rest-api-description) into
 * `src/ingestion/sources/openapi/github.json`. See vendor-stripe-spec.ts.
 *
 * The upstream document is ~13MB (819 paths); only the 3 operations below
 * and their transitive schema closure are kept.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
  operations: [
    { path: '/repos/{owner}/{repo}/issues', method: 'post' },
    { path: '/repos/{owner}/{repo}/issues/{issue_number}/comments', method: 'post' },
    { path: '/repos/{owner}/{repo}/pulls', method: 'post' },
  ],
  outPath: 'src/ingestion/sources/openapi/github.json',
  title: 'GitHub REST API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
