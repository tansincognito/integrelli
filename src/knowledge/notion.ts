import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';

export const NOTION_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'notion.create_page',
    service: 'notion',
    serviceLabel: 'Notion',
    apiVersion: NOTION_VERSION,
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/pages',
    auth: { kind: 'bearer', envVar: 'NOTION_API_KEY' },
    headers: { 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['parent', 'properties'],
      properties: {
        parent: {
          type: 'object',
          description: 'Either {database_id} or {page_id}.',
          properties: {
            database_id: { type: 'string' },
            page_id: { type: 'string' },
          },
        },
        properties: {
          type: 'object',
          description: 'Page property values keyed by property name, shaped per the parent database schema.',
        },
        children: {
          type: 'array',
          description: 'Optional block objects for the page body.',
          items: { type: 'object' },
        },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['id', 'object', 'url'],
      properties: {
        id: { type: 'string' },
        object: { type: 'string', enum: ['page'] },
        created_time: { type: 'string', format: 'date-time' },
        url: { type: 'string', format: 'uri' },
        properties: { type: 'object' },
      },
    },
    exampleResponse: {
      id: 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
      object: 'page',
      created_time: '2026-08-22T01:30:00.000Z',
      url: 'https://www.notion.so/Call-summary-a1b2c3d4e5f64789a012b3c4d5e6f7a8',
      properties: {
        Name: { title: [{ plain_text: 'Call summary' }] },
      },
    },
    description: 'Create a new page in a Notion database or as a child of another page.',
    keywords: ['notion', 'create page', 'new page', 'database entry', 'log'],
    docsUrl: 'https://developers.notion.com/reference/post-page',
  },
  {
    id: 'notion.query_database',
    service: 'notion',
    serviceLabel: 'Notion',
    apiVersion: NOTION_VERSION,
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/databases/:database_id/query',
    auth: { kind: 'bearer', envVar: 'NOTION_API_KEY' },
    headers: { 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
    params: [
      {
        name: 'database_id',
        location: 'path',
        required: true,
        type: 'string',
        description: 'ID of the database to query.',
        example: 'd9824bdc-8445-4327-be8b-5b47500af6ce',
      },
    ],
    requestSchema: {
      type: 'object',
      properties: {
        filter: { type: 'object', description: 'Notion filter object.' },
        sorts: { type: 'array', items: { type: 'object' } },
        page_size: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['object', 'results', 'has_more'],
      properties: {
        object: { type: 'string', enum: ['list'] },
        results: { type: 'array', items: { type: 'object' } },
        next_cursor: { type: 'string' },
        has_more: { type: 'boolean' },
      },
    },
    exampleResponse: {
      object: 'list',
      results: [
        {
          id: 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
          object: 'page',
          properties: { Name: { title: [{ plain_text: 'Call summary' }] } },
        },
      ],
      next_cursor: '',
      has_more: false,
    },
    description: 'Query a Notion database, optionally with filters and sorts.',
    keywords: ['notion', 'query database', 'search', 'filter', 'list pages'],
    docsUrl: 'https://developers.notion.com/reference/post-database-query',
  },
  {
    id: 'notion.append_block_children',
    service: 'notion',
    serviceLabel: 'Notion',
    apiVersion: NOTION_VERSION,
    method: 'PATCH',
    baseUrl: BASE_URL,
    path: '/v1/blocks/:block_id/children',
    auth: { kind: 'bearer', envVar: 'NOTION_API_KEY' },
    headers: { 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
    params: [
      {
        name: 'block_id',
        location: 'path',
        required: true,
        type: 'string',
        description: 'ID of the parent block or page to append children to.',
        example: 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['children'],
      properties: {
        children: {
          type: 'array',
          description: 'Array of block objects to append.',
          items: { type: 'object' },
        },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['object', 'results'],
      properties: {
        object: { type: 'string', enum: ['list'] },
        results: { type: 'array', items: { type: 'object' } },
      },
    },
    exampleResponse: {
      object: 'list',
      results: [
        {
          id: 'f7e6d5c4-b3a2-4190-8765-4321fedcba98',
          object: 'block',
          type: 'paragraph',
        },
      ],
    },
    description: 'Append new block content (paragraphs, lists, etc.) to an existing page or block.',
    keywords: ['notion', 'append block', 'add content', 'page body', 'blocks'],
    docsUrl: 'https://developers.notion.com/reference/patch-block-children',
  },
];
