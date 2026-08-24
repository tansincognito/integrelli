import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://api.airtable.com';

export const AIRTABLE_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'airtable.create_records',
    service: 'airtable',
    serviceLabel: 'Airtable',
    apiVersion: 'v0',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v0/:baseId/:tableIdOrName',
    auth: { kind: 'bearer', envVar: 'AIRTABLE_API_KEY' },
    headers: { 'Content-Type': 'application/json' },
    params: [
      {
        name: 'baseId',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Airtable base ID.',
        example: 'appAbCdEfGhIjKlMn',
      },
      {
        name: 'tableIdOrName',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Table ID or URL-encoded table name.',
        example: 'Orders',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['records'],
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            required: ['fields'],
            properties: {
              fields: { type: 'object', description: 'Field name -> value map.' },
            },
          },
        },
        typecast: { type: 'boolean', description: 'Automatically convert string values to the field type.' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['records'],
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              createdTime: { type: 'string', format: 'date-time' },
              fields: { type: 'object' },
            },
          },
        },
      },
    },
    exampleResponse: {
      records: [
        {
          id: 'recA1b2C3d4E5f6G7',
          createdTime: '2026-08-22T01:30:00.000Z',
          fields: { Name: 'Jane Doe', Amount: 20, Status: 'Paid' },
        },
      ],
    },
    description: 'Create one or more records in an Airtable table.',
    keywords: ['airtable', 'create record', 'row', 'insert', 'database'],
    docsUrl: 'https://airtable.com/developers/web/api/create-records',
  },
  {
    id: 'airtable.list_records',
    service: 'airtable',
    serviceLabel: 'Airtable',
    apiVersion: 'v0',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/v0/:baseId/:tableIdOrName',
    auth: { kind: 'bearer', envVar: 'AIRTABLE_API_KEY' },
    headers: {},
    params: [
      {
        name: 'baseId',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Airtable base ID.',
        example: 'appAbCdEfGhIjKlMn',
      },
      {
        name: 'tableIdOrName',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Table ID or URL-encoded table name.',
        example: 'Orders',
      },
      {
        name: 'view',
        location: 'query',
        required: false,
        type: 'string',
        description: 'Name of a view to fetch records from.',
        example: 'Grid view',
      },
      {
        name: 'maxRecords',
        location: 'query',
        required: false,
        type: 'number',
        description: 'Maximum total records to return.',
        example: 50,
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['records'],
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              createdTime: { type: 'string', format: 'date-time' },
              fields: { type: 'object' },
            },
          },
        },
        offset: { type: 'string' },
      },
    },
    exampleResponse: {
      records: [
        {
          id: 'recA1b2C3d4E5f6G7',
          createdTime: '2026-08-22T01:30:00.000Z',
          fields: { Name: 'Jane Doe', Amount: 20, Status: 'Paid' },
        },
      ],
    },
    description: 'List records from an Airtable table, optionally filtered by a view or formula.',
    keywords: ['airtable', 'list records', 'query', 'read rows', 'database'],
    docsUrl: 'https://airtable.com/developers/web/api/list-records',
  },
  {
    id: 'airtable.update_records',
    service: 'airtable',
    serviceLabel: 'Airtable',
    apiVersion: 'v0',
    method: 'PATCH',
    baseUrl: BASE_URL,
    path: '/v0/:baseId/:tableIdOrName',
    auth: { kind: 'bearer', envVar: 'AIRTABLE_API_KEY' },
    headers: { 'Content-Type': 'application/json' },
    params: [
      {
        name: 'baseId',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Airtable base ID.',
        example: 'appAbCdEfGhIjKlMn',
      },
      {
        name: 'tableIdOrName',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Table ID or URL-encoded table name.',
        example: 'Orders',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['records'],
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'fields'],
            properties: {
              id: { type: 'string', description: 'Record ID to update.' },
              fields: { type: 'object', description: 'Field name -> new value map.' },
            },
          },
        },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['records'],
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              createdTime: { type: 'string', format: 'date-time' },
              fields: { type: 'object' },
            },
          },
        },
      },
    },
    exampleResponse: {
      records: [
        {
          id: 'recA1b2C3d4E5f6G7',
          createdTime: '2026-08-22T01:30:00.000Z',
          fields: { Name: 'Jane Doe', Amount: 20, Status: 'Refunded' },
        },
      ],
    },
    description: 'Update one or more existing records in an Airtable table.',
    keywords: ['airtable', 'update record', 'patch row', 'edit', 'database'],
    docsUrl: 'https://airtable.com/developers/web/api/update-multiple-records',
  },
];
