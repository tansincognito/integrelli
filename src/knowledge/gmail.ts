import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://gmail.googleapis.com';

export const GMAIL_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'gmail.send_message',
    service: 'gmail',
    serviceLabel: 'Gmail',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/gmail/v1/users/:userId/messages/send',
    auth: { kind: 'bearer', envVar: 'GMAIL_ACCESS_TOKEN' },
    headers: { 'Content-Type': 'application/json' },
    params: [
      {
        name: 'userId',
        location: 'path',
        required: true,
        type: 'string',
        description: 'User ID; use "me" for the authenticated user.',
        example: 'me',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['raw'],
      properties: {
        raw: {
          type: 'string',
          description: 'Entire RFC 2822 email, base64url-encoded (headers + body).',
        },
        threadId: { type: 'string', description: 'Thread to append this message to.' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['id', 'threadId', 'labelIds'],
      properties: {
        id: { type: 'string' },
        threadId: { type: 'string' },
        labelIds: { type: 'array', items: { type: 'string' } },
      },
    },
    exampleResponse: {
      id: '18f2a3b4c5d6e7f8',
      threadId: '18f2a3b4c5d6e7f8',
      labelIds: ['SENT'],
    },
    description: 'Send an email as the authenticated Gmail user.',
    keywords: ['send email', 'email', 'gmail', 'send message', 'notify'],
    docsUrl: 'https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send',
  },
  {
    id: 'gmail.get_message',
    service: 'gmail',
    serviceLabel: 'Gmail',
    apiVersion: 'v1',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/gmail/v1/users/:userId/messages/:id',
    auth: { kind: 'bearer', envVar: 'GMAIL_ACCESS_TOKEN' },
    headers: {},
    params: [
      {
        name: 'userId',
        location: 'path',
        required: true,
        type: 'string',
        description: 'User ID; use "me" for the authenticated user.',
        example: 'me',
      },
      {
        name: 'id',
        location: 'path',
        required: true,
        type: 'string',
        description: 'The id of the message to retrieve.',
        example: '18f2a3b4c5d6e7f8',
      },
      {
        name: 'format',
        location: 'query',
        required: false,
        type: 'string',
        description: 'Message format: full, metadata, minimal, or raw.',
        example: 'full',
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['id', 'threadId', 'labelIds', 'snippet'],
      properties: {
        id: { type: 'string' },
        threadId: { type: 'string' },
        labelIds: { type: 'array', items: { type: 'string' } },
        snippet: { type: 'string' },
        payload: {
          type: 'object',
          properties: {
            mimeType: { type: 'string' },
            headers: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, value: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    exampleResponse: {
      id: '18f2a3b4c5d6e7f8',
      threadId: '18f2a3b4c5d6e7f8',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Hey, just following up on the invoice...',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'jane@example.com' },
          { name: 'Subject', value: 'Invoice follow-up' },
        ],
      },
    },
    description: 'Fetch a single Gmail message by id, including headers and snippet.',
    keywords: ['get email', 'read email', 'fetch message', 'gmail'],
    docsUrl: 'https://developers.google.com/gmail/api/reference/rest/v1/users.messages/get',
  },
  {
    id: 'gmail.create_draft',
    service: 'gmail',
    serviceLabel: 'Gmail',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/gmail/v1/users/:userId/drafts',
    auth: { kind: 'bearer', envVar: 'GMAIL_ACCESS_TOKEN' },
    headers: { 'Content-Type': 'application/json' },
    params: [
      {
        name: 'userId',
        location: 'path',
        required: true,
        type: 'string',
        description: 'User ID; use "me" for the authenticated user.',
        example: 'me',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'object',
          required: ['raw'],
          properties: {
            raw: { type: 'string', description: 'Base64url-encoded RFC 2822 email.' },
            threadId: { type: 'string' },
          },
        },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['id', 'message'],
      properties: {
        id: { type: 'string' },
        message: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            threadId: { type: 'string' },
            labelIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    exampleResponse: {
      id: 'r-1029384756',
      message: {
        id: '18f2a3b4c5d6e7f9',
        threadId: '18f2a3b4c5d6e7f9',
        labelIds: ['DRAFT'],
      },
    },
    description: 'Create a draft email for the authenticated user without sending it.',
    keywords: ['draft', 'save draft', 'gmail draft', 'compose'],
    docsUrl: 'https://developers.google.com/gmail/api/reference/rest/v1/users.drafts/create',
  },
];
