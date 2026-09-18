/**
 * Curates Mailchimp's real, published Swagger 2.0 document
 * (api.mailchimp.com/schema/3.0/Swagger.json) into
 * `src/ingestion/sources/openapi/mailchimp.json`, converted to OpenAPI 3
 * shape. Mailchimp splits every path/parameter/definition into its own file
 * on its schema server and `$ref`s them by absolute URL — see
 * scripts/lib/swagger2-curator.ts's `inlineRemoteRefs` for how those get
 * fetched and folded into a local, ingestible document.
 */

import { curateSwagger2 } from './lib/swagger2-curator';

curateSwagger2({
  specUrl: 'https://api.mailchimp.com/schema/3.0/Swagger.json',
  operations: [
    { path: '/lists/{list_id}/members', method: 'post' },
    { path: '/campaigns/{campaign_id}/actions/send', method: 'post' },
  ],
  outPath: 'src/ingestion/sources/openapi/mailchimp.json',
  title: 'Mailchimp Marketing API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
