# ElevenLabs API v1

Reference prose for the ElevenLabs capabilities seeded on Day 1. This document
stands in for the published API reference at https://elevenlabs.io/docs/api-reference
and is deliberately ingested through the documentation path (chunk → extract →
validate) rather than through OpenAPI, so the pipeline is exercised on prose.

## Text to Speech

`POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`

Converts a block of text into spoken audio using the selected voice and returns
a generated audio file together with the identifier of the generation request.

### Authentication

Header `xi-api-key`.

### Path parameters

| field | type | required | description |
| --- | --- | --- | --- |
| voice_id | string | yes | Identifier of the voice to speak with. |

### Request body

| field | type | required | description |
| --- | --- | --- | --- |
| text | string | yes | The text to convert into speech. |
| model_id | string | no | Identifier of the model to use, for example eleven_multilingual_v2. |
| output_format | string | no | Audio output format, for example mp3_44100_128. |

### Response

| field | type | description |
| --- | --- | --- |
| audio_url | string | URL of the generated audio file. |
| request_id | string | Identifier of the generation request. |

## List Voices

`GET https://api.elevenlabs.io/v1/voices`

Returns every voice available to the account, including the voice identifiers
required by the text to speech endpoint.

### Authentication

Header `xi-api-key`.

### Query parameters

| field | type | required | description |
| --- | --- | --- | --- |
| show_legacy | boolean | no | Include legacy voices in the response. |

### Response

| field | type | description |
| --- | --- | --- |
| voices | array | Available voices, each with a voice_id and a name. |
