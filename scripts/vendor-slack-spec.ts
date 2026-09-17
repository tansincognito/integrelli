/**
 * Curates Slack's real, published Swagger 2.0 document
 * (github.com/slackapi/slack-api-specs) into
 * `src/ingestion/sources/openapi/slack.json`, converted to OpenAPI 3 shape.
 * See scripts/lib/swagger2-curator.ts for the conversion rationale.
 */

import { curateSwagger2 } from './lib/swagger2-curator';

curateSwagger2({
  specUrl: 'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json',
  operations: [
    { path: '/chat.postMessage', method: 'post' },
    { path: '/conversations.list', method: 'get' },
    { path: '/conversations.create', method: 'post' },
  ],
  outPath: 'src/ingestion/sources/openapi/slack.json',
  title: 'Slack Web API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
