import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://api.elevenlabs.io';

export const ELEVENLABS_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'elevenlabs.text_to_speech',
    service: 'elevenlabs',
    serviceLabel: 'ElevenLabs',
    apiVersion: 'v1',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/text-to-speech/:voice_id/with-timestamps',
    auth: { kind: 'header', headerName: 'xi-api-key', envVar: 'ELEVENLABS_API_KEY' },
    headers: { 'Content-Type': 'application/json' },
    params: [
      {
        name: 'voice_id',
        location: 'path',
        required: true,
        type: 'string',
        description: 'ID of the voice to use for synthesis.',
        example: '21m00Tcm4TlvDq8ikWAM',
      },
    ],
    requestSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Text to convert to speech.' },
        model_id: { type: 'string', description: 'TTS model, e.g. eleven_multilingual_v2.' },
        voice_settings: {
          type: 'object',
          properties: {
            stability: { type: 'number', minimum: 0, maximum: 1 },
            similarity_boost: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['audio_base64', 'alignment'],
      properties: {
        audio_base64: { type: 'string', description: 'Base64-encoded MP3 audio.' },
        alignment: {
          type: 'object',
          properties: {
            characters: { type: 'array', items: { type: 'string' } },
            character_start_times_seconds: { type: 'array', items: { type: 'number' } },
            character_end_times_seconds: { type: 'array', items: { type: 'number' } },
          },
        },
        normalized_alignment: {
          type: 'object',
          properties: {
            characters: { type: 'array', items: { type: 'string' } },
            character_start_times_seconds: { type: 'array', items: { type: 'number' } },
            character_end_times_seconds: { type: 'array', items: { type: 'number' } },
          },
        },
      },
    },
    exampleResponse: {
      audio_base64: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMA==',
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0.0, 0.1],
        character_end_times_seconds: [0.1, 0.2],
      },
      normalized_alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0.0, 0.1],
        character_end_times_seconds: [0.1, 0.2],
      },
    },
    description:
      'Convert text to speech with a given voice, returning base64 audio plus character-level timing alignment.',
    keywords: ['tts', 'text to speech', 'voice', 'audio', 'synthesize', 'speak'],
    docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps',
  },
  {
    id: 'elevenlabs.get_conversation',
    service: 'elevenlabs',
    serviceLabel: 'ElevenLabs',
    apiVersion: 'v1',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/v1/convai/conversations/:conversation_id',
    auth: { kind: 'header', headerName: 'xi-api-key', envVar: 'ELEVENLABS_API_KEY' },
    headers: {},
    params: [
      {
        name: 'conversation_id',
        location: 'path',
        required: true,
        type: 'string',
        description: 'ID of the conversational AI call to fetch.',
        example: 'conv_a1b2c3d4',
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['agent_id', 'conversation_id', 'status', 'transcript'],
      properties: {
        agent_id: { type: 'string' },
        conversation_id: { type: 'string' },
        status: { type: 'string', enum: ['processing', 'done', 'failed'] },
        transcript: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['agent', 'user'] },
              message: { type: 'string' },
              time_in_call_secs: { type: 'number' },
            },
          },
        },
        metadata: {
          type: 'object',
          properties: {
            start_time_unix_secs: { type: 'integer' },
            call_duration_secs: { type: 'integer' },
            cost: { type: 'number' },
          },
        },
      },
    },
    exampleResponse: {
      agent_id: 'agent_9f8e7d6c',
      conversation_id: 'conv_a1b2c3d4',
      status: 'done',
      transcript: [
        { role: 'agent', message: 'Hi, how can I help?', time_in_call_secs: 0 },
        { role: 'user', message: 'I need a refund.', time_in_call_secs: 3 },
      ],
      metadata: { start_time_unix_secs: 1716239022, call_duration_secs: 47, cost: 152 },
    },
    description:
      'Retrieve the full transcript, status, and metadata for a completed or in-progress conversational AI call.',
    keywords: ['call', 'conversation', 'transcript', 'convai', 'agent', 'call detail'],
    docsUrl: 'https://elevenlabs.io/docs/api-reference/conversations/get-conversation',
  },
  {
    id: 'elevenlabs.list_voices',
    service: 'elevenlabs',
    serviceLabel: 'ElevenLabs',
    apiVersion: 'v1',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/v1/voices',
    auth: { kind: 'header', headerName: 'xi-api-key', envVar: 'ELEVENLABS_API_KEY' },
    headers: {},
    params: [],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['voices'],
      properties: {
        voices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              voice_id: { type: 'string' },
              name: { type: 'string' },
              category: { type: 'string' },
              preview_url: { type: 'string', format: 'uri' },
            },
          },
        },
      },
    },
    exampleResponse: {
      voices: [
        {
          voice_id: '21m00Tcm4TlvDq8ikWAM',
          name: 'Rachel',
          category: 'premade',
          preview_url: 'https://example.com/voices/rachel-preview.mp3',
        },
        {
          voice_id: 'AZnzlk1XvdvUeBnXmlld',
          name: 'Domi',
          category: 'premade',
          preview_url: 'https://example.com/voices/domi-preview.mp3',
        },
      ],
    },
    description: 'List all voices available to the account, including id, name, and category.',
    keywords: ['voices', 'list voices', 'voice id', 'catalog'],
    docsUrl: 'https://elevenlabs.io/docs/api-reference/voices/search',
  },
];
