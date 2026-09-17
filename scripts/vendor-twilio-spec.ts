/**
 * Curates Twilio's real, published OpenAPI document
 * (github.com/twilio/twilio-oai) into
 * `src/ingestion/sources/openapi/twilio.json`. See vendor-stripe-spec.ts for
 * the shared rationale (offline/deterministic ingestion, real-data-only).
 */

import { curateOpenApi3 } from './lib/openapi3-curator';

curateOpenApi3({
  specUrl: 'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json',
  operations: [
    { path: '/2010-04-01/Accounts/{AccountSid}/Messages.json', method: 'post' },
    { path: '/2010-04-01/Accounts/{AccountSid}/Messages/{Sid}.json', method: 'get' },
  ],
  outPath: 'src/ingestion/sources/openapi/twilio.json',
  title: 'Twilio API (curated real subset)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
