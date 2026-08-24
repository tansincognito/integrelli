import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://api.twilio.com';

const FORM_ENCODED_NOTE =
  'Body is application/x-www-form-urlencoded, not JSON (standard Twilio REST convention).';

export const TWILIO_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'twilio.create_message',
    service: 'twilio',
    serviceLabel: 'Twilio',
    apiVersion: '2010-04-01',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/2010-04-01/Accounts/:AccountSid/Messages.json',
    auth: { kind: 'basic', usernameEnvVar: 'TWILIO_ACCOUNT_SID', passwordEnvVar: 'TWILIO_AUTH_TOKEN' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    params: [
      {
        name: 'AccountSid',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Twilio Account SID that owns the message.',
        example: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['To', 'From', 'Body'],
      description: FORM_ENCODED_NOTE,
      properties: {
        To: { type: 'string', description: 'Recipient phone number, E.164 format.' },
        From: { type: 'string', description: 'Twilio sending number, E.164 format.' },
        Body: { type: 'string', description: 'SMS message text.' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['sid', 'status', 'to', 'from', 'body'],
      properties: {
        sid: { type: 'string' },
        status: {
          type: 'string',
          enum: ['queued', 'sending', 'sent', 'failed', 'delivered', 'undelivered'],
        },
        to: { type: 'string' },
        from: { type: 'string' },
        body: { type: 'string' },
        date_created: { type: 'string' },
        price: { type: 'string' },
      },
    },
    exampleResponse: {
      sid: 'SM1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6',
      status: 'queued',
      to: '+15558675309',
      from: '+15017122661',
      body: 'Your payment of $20.00 was received. Thank you!',
      date_created: 'Thu, 22 Aug 2026 01:30:00 +0000',
      price: '0.00',
    },
    description: 'Send an SMS or MMS message via Twilio.',
    keywords: ['sms', 'text message', 'twilio', 'send sms', 'notify'],
    docsUrl: 'https://www.twilio.com/docs/sms/api/message-resource#create-a-message-resource',
  },
  {
    id: 'twilio.fetch_message',
    service: 'twilio',
    serviceLabel: 'Twilio',
    apiVersion: '2010-04-01',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/2010-04-01/Accounts/:AccountSid/Messages/:Sid.json',
    auth: { kind: 'basic', usernameEnvVar: 'TWILIO_ACCOUNT_SID', passwordEnvVar: 'TWILIO_AUTH_TOKEN' },
    headers: {},
    params: [
      {
        name: 'AccountSid',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Twilio Account SID that owns the message.',
        example: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        name: 'Sid',
        location: 'path',
        required: true,
        type: 'string',
        description: 'SID of the message to fetch.',
        example: 'SM1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6',
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['sid', 'status', 'to', 'from', 'body'],
      properties: {
        sid: { type: 'string' },
        status: {
          type: 'string',
          enum: ['queued', 'sending', 'sent', 'failed', 'delivered', 'undelivered'],
        },
        to: { type: 'string' },
        from: { type: 'string' },
        body: { type: 'string' },
        date_sent: { type: 'string' },
      },
    },
    exampleResponse: {
      sid: 'SM1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6',
      status: 'delivered',
      to: '+15558675309',
      from: '+15017122661',
      body: 'Your payment of $20.00 was received. Thank you!',
      date_sent: 'Thu, 22 Aug 2026 01:30:02 +0000',
    },
    description: 'Fetch the current status and content of a previously sent message.',
    keywords: ['sms status', 'delivery status', 'twilio', 'fetch message'],
    docsUrl: 'https://www.twilio.com/docs/sms/api/message-resource#fetch-a-message-resource',
  },
  {
    id: 'twilio.list_messages',
    service: 'twilio',
    serviceLabel: 'Twilio',
    apiVersion: '2010-04-01',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/2010-04-01/Accounts/:AccountSid/Messages.json',
    auth: { kind: 'basic', usernameEnvVar: 'TWILIO_ACCOUNT_SID', passwordEnvVar: 'TWILIO_AUTH_TOKEN' },
    headers: {},
    params: [
      {
        name: 'AccountSid',
        location: 'path',
        required: true,
        type: 'string',
        description: 'Twilio Account SID that owns the messages.',
        example: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        name: 'To',
        location: 'query',
        required: false,
        type: 'string',
        description: 'Filter by recipient phone number.',
        example: '+15558675309',
      },
      {
        name: 'PageSize',
        location: 'query',
        required: false,
        type: 'number',
        description: 'Number of results per page.',
        example: 20,
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['messages'],
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sid: { type: 'string' },
              status: { type: 'string' },
              to: { type: 'string' },
              from: { type: 'string' },
              body: { type: 'string' },
            },
          },
        },
        next_page_uri: { type: 'string' },
      },
    },
    exampleResponse: {
      messages: [
        {
          sid: 'SM1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6',
          status: 'delivered',
          to: '+15558675309',
          from: '+15017122661',
          body: 'Your payment of $20.00 was received. Thank you!',
        },
      ],
      next_page_uri: '',
    },
    description: 'List sent/received messages for the account, optionally filtered by recipient or date.',
    keywords: ['sms history', 'list messages', 'twilio', 'message log'],
    docsUrl: 'https://www.twilio.com/docs/sms/api/message-resource#read-multiple-message-resources',
  },
];
