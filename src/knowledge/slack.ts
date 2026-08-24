import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://slack.com';

export const SLACK_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'slack.post_message',
    service: 'slack',
    serviceLabel: 'Slack',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/api/chat.postMessage',
    auth: { kind: 'bearer', envVar: 'SLACK_BOT_TOKEN' },
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['channel', 'text'],
      properties: {
        channel: { type: 'string', description: 'Channel ID or name, e.g. C0123ABC.' },
        text: { type: 'string', description: 'Message text (fallback if blocks are used).' },
        thread_ts: { type: 'string', description: 'Timestamp of a parent message to reply in-thread.' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        channel: { type: 'string' },
        ts: { type: 'string' },
        message: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            user: { type: 'string' },
            ts: { type: 'string' },
          },
        },
      },
    },
    exampleResponse: {
      ok: true,
      channel: 'C0123ABC',
      ts: '1716239022.123456',
      message: {
        text: 'Deploy finished successfully.',
        user: 'U0BOTUSER',
        ts: '1716239022.123456',
      },
    },
    description: 'Post a message to a Slack channel or thread.',
    keywords: ['slack', 'notify', 'post message', 'send message', 'chat', 'alert'],
    docsUrl: 'https://api.slack.com/methods/chat.postMessage',
  },
  {
    id: 'slack.list_conversations',
    service: 'slack',
    serviceLabel: 'Slack',
    apiVersion: 'v1',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/api/conversations.list',
    auth: { kind: 'bearer', envVar: 'SLACK_BOT_TOKEN' },
    headers: {},
    params: [
      {
        name: 'types',
        location: 'query',
        required: false,
        type: 'string',
        description: 'Comma-separated conversation types, e.g. "public_channel,private_channel".',
        example: 'public_channel',
      },
      {
        name: 'limit',
        location: 'query',
        required: false,
        type: 'number',
        description: 'Max number of items to return per page.',
        example: 100,
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['ok', 'channels'],
      properties: {
        ok: { type: 'boolean' },
        channels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              is_channel: { type: 'boolean' },
              is_private: { type: 'boolean' },
            },
          },
        },
        response_metadata: {
          type: 'object',
          properties: { next_cursor: { type: 'string' } },
        },
      },
    },
    exampleResponse: {
      ok: true,
      channels: [
        { id: 'C0123ABC', name: 'general', is_channel: true, is_private: false },
        { id: 'C0456DEF', name: 'engineering', is_channel: true, is_private: false },
      ],
      response_metadata: { next_cursor: '' },
    },
    description: 'List channels/conversations visible to the bot token.',
    keywords: ['slack', 'channels', 'list channels', 'conversations'],
    docsUrl: 'https://api.slack.com/methods/conversations.list',
  },
  {
    id: 'slack.upload_file',
    service: 'slack',
    serviceLabel: 'Slack',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/api/files.upload',
    auth: { kind: 'bearer', envVar: 'SLACK_BOT_TOKEN' },
    headers: { 'Content-Type': 'multipart/form-data' },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['channels', 'content'],
      description: 'Body is multipart/form-data; fields below describe the logical form fields.',
      properties: {
        channels: { type: 'string', description: 'Comma-separated channel IDs to share the file to.' },
        content: { type: 'string', description: 'File contents, if uploading raw text instead of a binary file.' },
        filename: { type: 'string' },
        title: { type: 'string' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['ok', 'file'],
      properties: {
        ok: { type: 'boolean' },
        file: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            url_private: { type: 'string', format: 'uri' },
            permalink: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    exampleResponse: {
      ok: true,
      file: {
        id: 'F0123ABCXYZ',
        name: 'transcript.txt',
        url_private: 'https://files.slack.com/files-pri/T0123-F0123ABCXYZ/transcript.txt',
        permalink: 'https://myteam.slack.com/files/U0BOTUSER/F0123ABCXYZ/transcript.txt',
      },
    },
    description: 'Upload a file (or text content) and share it to one or more channels.',
    keywords: ['slack', 'upload file', 'attach', 'file share', 'transcript'],
    docsUrl: 'https://api.slack.com/methods/files.upload',
  },
];
