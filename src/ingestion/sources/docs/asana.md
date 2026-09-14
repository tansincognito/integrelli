# Asana API v1.0

Reference prose for the Asana task capabilities seeded in the provider
expansion. This document stands in for
https://developers.asana.com/reference/rest-api-reference and is ingested
through the documentation path — Asana's upstream OpenAPI description is
published as YAML, and this pipeline's `parseOpenApi` only reads JSON, so
Asana is deliberately routed through the markdown/LLM extractor instead of
the OpenAPI one. Its capabilities carry lower base confidence than an
OpenAPI-derived provider's for exactly that reason, and there is no
cross-check document available to raise it back up.

## Create Task

`POST https://app.asana.com/api/1.0/tasks`

Creates a new task and returns it, wrapped in a `data` envelope as every
Asana response is.

### Authentication

Bearer token (a Personal Access Token or an OAuth2 access token).

### Request body

| field | type | required | description |
| --- | --- | --- | --- |
| data | object | yes | Envelope object holding the task fields below. |
| data.name | string | yes | Name of the task. |
| data.notes | string | no | Free-form text description of the task. |
| data.projects | array | no | Project GIDs to add this task to. |
| data.assignee | string | no | GID of the user to assign the task to. |
| data.due_on | string | no | Due date in YYYY-MM-DD form. |

### Response

| field | type | description |
| --- | --- | --- |
| data.gid | string | Identifier of the created task. |
| data.name | string | Name of the task. |
| data.permalink_url | string | Asana web URL for the task. |

## Get Task

`GET https://app.asana.com/api/1.0/tasks/{task_gid}`

Retrieves a single task by its global identifier.

### Authentication

Bearer token (a Personal Access Token or an OAuth2 access token).

### Response

| field | type | description |
| --- | --- | --- |
| data.gid | string | Identifier of the task. |
| data.name | string | Name of the task. |
| data.completed | boolean | Whether the task is marked complete. |
| data.notes | string | Free-form text description of the task. |

## Update Task

`PUT https://app.asana.com/api/1.0/tasks/{task_gid}`

Updates fields on an existing task, for example to mark it complete.

### Authentication

Bearer token (a Personal Access Token or an OAuth2 access token).

### Request body

| field | type | required | description |
| --- | --- | --- | --- |
| data | object | yes | Envelope object holding the fields to change. |
| data.name | string | no | New name for the task. |
| data.completed | boolean | no | Marks the task complete or incomplete. |
| data.notes | string | no | New free-form description. |

### Response

| field | type | description |
| --- | --- | --- |
| data.gid | string | Identifier of the task. |
| data.completed | boolean | Whether the task is marked complete. |
