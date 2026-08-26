import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://api.openai.com';

export const OPENAI_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'openai.chat_completions',
    service: 'openai',
    serviceLabel: 'OpenAI',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/chat/completions',
    auth: { kind: 'bearer', envVar: 'OPENAI_API_KEY' },
    headers: { 'Content-Type': 'application/json' },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['model', 'messages'],
      properties: {
        model: { type: 'string', description: 'Model id, e.g. gpt-4o-mini.' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['role', 'content'],
            properties: {
              role: { type: 'string', enum: ['system', 'user', 'assistant'] },
              content: { type: 'string' },
            },
          },
        },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['id', 'object', 'choices', 'usage'],
      properties: {
        id: { type: 'string' },
        object: { type: 'string', enum: ['chat.completion'] },
        model: { type: 'string' },
        choices: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'message', 'finish_reason'],
            properties: {
              index: { type: 'integer' },
              message: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string' },
                  content: { type: 'string' },
                },
              },
              finish_reason: { type: 'string' },
            },
          },
        },
        usage: {
          type: 'object',
          properties: {
            prompt_tokens: { type: 'integer' },
            completion_tokens: { type: 'integer' },
            total_tokens: { type: 'integer' },
          },
        },
      },
    },
    exampleResponse: {
      id: 'chatcmpl-9f8e7d6c5b4a3210',
      object: 'chat.completion',
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Summary: the customer requested a refund.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
    },
    description: 'Generate a chat completion from a list of messages.',
    keywords: ['chat', 'completion', 'gpt', 'summarize', 'generate text', 'llm'],
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat/create',
  },
  {
    id: 'openai.create_embeddings',
    service: 'openai',
    serviceLabel: 'OpenAI',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/embeddings',
    auth: { kind: 'bearer', envVar: 'OPENAI_API_KEY' },
    headers: { 'Content-Type': 'application/json' },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['model', 'input'],
      properties: {
        model: { type: 'string', description: 'Embedding model id, e.g. text-embedding-3-small.' },
        input: { type: 'string', description: 'Text to embed (or array of strings).' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['object', 'data', 'model'],
      properties: {
        object: { type: 'string', enum: ['list'] },
        model: { type: 'string' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              object: { type: 'string', enum: ['embedding'] },
              embedding: { type: 'array', items: { type: 'number' } },
              index: { type: 'integer' },
            },
          },
        },
        usage: {
          type: 'object',
          properties: {
            prompt_tokens: { type: 'integer' },
            total_tokens: { type: 'integer' },
          },
        },
      },
    },
    exampleResponse: {
      object: 'list',
      model: 'text-embedding-3-small',
      data: [{ object: 'embedding', embedding: [0.0023, -0.0091, 0.0154], index: 0 }],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    },
    description: 'Create a vector embedding for the given input text.',
    keywords: ['embedding', 'vector', 'similarity', 'retrieval', 'openai'],
    docsUrl: 'https://platform.openai.com/docs/api-reference/embeddings/create',
  },
  {
    id: 'openai.audio_transcriptions',
    service: 'openai',
    serviceLabel: 'OpenAI',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/audio/transcriptions',
    auth: { kind: 'bearer', envVar: 'OPENAI_API_KEY' },
    headers: { 'Content-Type': 'multipart/form-data' },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['file', 'model'],
      description: 'Body is multipart/form-data; "file" is a binary audio upload field.',
      properties: {
        file: { type: 'string', description: 'Audio file to transcribe (binary form field).' },
        model: { type: 'string', description: 'Transcription model id, e.g. whisper-1.' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
      },
    },
    exampleResponse: {
      text: 'Hi, I need help with a refund for my last order.',
    },
    description: 'Transcribe an audio file to text.',
    keywords: ['transcription', 'whisper', 'speech to text', 'audio', 'stt'],
    docsUrl: 'https://platform.openai.com/docs/api-reference/audio/createTranscription',
  },
];
