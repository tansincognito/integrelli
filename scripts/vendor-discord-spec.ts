/**
 * Curates Discord's real, published OpenAPI document
 * (github.com/discord/discord-api-spec) into
 * `src/ingestion/sources/openapi/discord.json`. See vendor-stripe-spec.ts.
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json',
  operations: [
    { path: '/channels/{channel_id}/messages', method: 'post' },
    { path: '/channels/{channel_id}/messages', method: 'get' },
  ],
  outPath: 'src/ingestion/sources/openapi/discord.json',
  title: 'Discord API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
