import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ALL_ENDPOINTS, byId } from '@/knowledge/index';
import type { ServiceId } from '@/types/endpoint';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

const ALL_SERVICES: ServiceId[] = [
  'elevenlabs',
  'stripe',
  'gmail',
  'slack',
  'twilio',
  'notion',
  'openai',
  'airtable',
];

describe('knowledge pack', () => {
  it('has at least one endpoint', () => {
    expect(ALL_ENDPOINTS.length).toBeGreaterThan(0);
  });

  it('has unique endpoint ids', () => {
    const ids = ALL_ENDPOINTS.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('byId map contains every endpoint', () => {
    expect(byId.size).toBe(ALL_ENDPOINTS.length);
    for (const endpoint of ALL_ENDPOINTS) {
      expect(byId.get(endpoint.id)).toBe(endpoint);
    }
  });

  it('includes all 8 services', () => {
    const servicesPresent = new Set(ALL_ENDPOINTS.map((e) => e.service));
    for (const service of ALL_SERVICES) {
      expect(servicesPresent.has(service)).toBe(true);
    }
  });

  it('has at least 3 endpoints per service', () => {
    for (const service of ALL_SERVICES) {
      const count = ALL_ENDPOINTS.filter((e) => e.service === service).length;
      expect(count, `service "${service}" has ${count} endpoints`).toBeGreaterThanOrEqual(3);
    }
  });

  it('every id follows the "<service>.<verb_noun>" format', () => {
    for (const endpoint of ALL_ENDPOINTS) {
      expect(endpoint.id.startsWith(`${endpoint.service}.`)).toBe(true);
    }
  });

  it('every requestSchema (when present) is a valid draft-07 JSON Schema Ajv can compile', () => {
    for (const endpoint of ALL_ENDPOINTS) {
      if (endpoint.requestSchema === null) continue;
      expect(() => {
        const validate = ajv.compile(endpoint.requestSchema as object);
        expect(typeof validate).toBe('function');
      }, `requestSchema for "${endpoint.id}" failed to compile`).not.toThrow();
    }
  });

  it('every responseSchema is a valid draft-07 JSON Schema Ajv can compile', () => {
    for (const endpoint of ALL_ENDPOINTS) {
      expect(() => {
        const validate = ajv.compile(endpoint.responseSchema as object);
        expect(typeof validate).toBe('function');
      }, `responseSchema for "${endpoint.id}" failed to compile`).not.toThrow();
    }
  });

  it('every exampleResponse validates against its own responseSchema', () => {
    for (const endpoint of ALL_ENDPOINTS) {
      const validate = ajv.compile(endpoint.responseSchema as object);
      const valid = validate(endpoint.exampleResponse);
      expect(
        valid,
        `exampleResponse for "${endpoint.id}" failed schema validation: ${JSON.stringify(validate.errors)}`
      ).toBe(true);
    }
  });

  it('every endpoint has non-empty description and keywords', () => {
    for (const endpoint of ALL_ENDPOINTS) {
      expect(endpoint.description.length, `description for "${endpoint.id}"`).toBeGreaterThan(0);
      expect(endpoint.keywords.length, `keywords for "${endpoint.id}"`).toBeGreaterThan(0);
    }
  });

  it('auth envVar names are SCREAMING_SNAKE_CASE (never literal secret values)', () => {
    const envVarRe = /^[A-Z0-9_]+$/;
    for (const endpoint of ALL_ENDPOINTS) {
      const auth = endpoint.auth;
      if (auth.kind === 'bearer' || auth.kind === 'query') {
        expect(envVarRe.test(auth.envVar), `${endpoint.id} auth.envVar`).toBe(true);
      } else if (auth.kind === 'header') {
        expect(envVarRe.test(auth.envVar), `${endpoint.id} auth.envVar`).toBe(true);
      } else if (auth.kind === 'basic') {
        expect(envVarRe.test(auth.usernameEnvVar), `${endpoint.id} auth.usernameEnvVar`).toBe(true);
        expect(envVarRe.test(auth.passwordEnvVar), `${endpoint.id} auth.passwordEnvVar`).toBe(true);
      }
    }
  });
});
