import type { EndpointSpec } from '@/types/endpoint';
import { ELEVENLABS_ENDPOINTS } from './elevenlabs';
import { STRIPE_ENDPOINTS } from './stripe';
import { GMAIL_ENDPOINTS } from './gmail';
import { SLACK_ENDPOINTS } from './slack';
import { TWILIO_ENDPOINTS } from './twilio';
import { NOTION_ENDPOINTS } from './notion';
import { OPENAI_ENDPOINTS } from './openai';
import { AIRTABLE_ENDPOINTS } from './airtable';

export const ALL_ENDPOINTS: EndpointSpec[] = [
  ...ELEVENLABS_ENDPOINTS,
  ...STRIPE_ENDPOINTS,
  ...GMAIL_ENDPOINTS,
  ...SLACK_ENDPOINTS,
  ...TWILIO_ENDPOINTS,
  ...NOTION_ENDPOINTS,
  ...OPENAI_ENDPOINTS,
  ...AIRTABLE_ENDPOINTS,
];

function buildByIdMap(endpoints: EndpointSpec[]): Map<string, EndpointSpec> {
  const map = new Map<string, EndpointSpec>();
  for (const endpoint of endpoints) {
    if (map.has(endpoint.id)) {
      throw new Error(`Duplicate EndpointSpec id in knowledge pack: "${endpoint.id}"`);
    }
    map.set(endpoint.id, endpoint);
  }
  return map;
}

export const byId: Map<string, EndpointSpec> = buildByIdMap(ALL_ENDPOINTS);

export {
  ELEVENLABS_ENDPOINTS,
  STRIPE_ENDPOINTS,
  GMAIL_ENDPOINTS,
  SLACK_ENDPOINTS,
  TWILIO_ENDPOINTS,
  NOTION_ENDPOINTS,
  OPENAI_ENDPOINTS,
  AIRTABLE_ENDPOINTS,
};
