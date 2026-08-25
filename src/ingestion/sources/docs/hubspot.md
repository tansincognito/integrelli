# HubSpot CRM v3

Reference prose for the HubSpot contact capabilities seeded on Day 1. This
document stands in for https://developers.hubspot.com/docs/api/crm/contacts and
is ingested through the documentation path. No OpenAPI document is seeded for
HubSpot, so its capabilities are deliberately left un-cross-checked — their
confidence is lower than Stripe's or Gmail's, and the retrieval layer surfaces
that difference.

## Create Contact

`POST https://api.hubapi.com/crm/v3/objects/contacts`

Creates a new contact record in the CRM from a set of property values and
returns the created contact with its identifier and creation timestamp.

### Authentication

Bearer token issued to a private app.

### Permissions

- crm.objects.contacts.write

### Request body

| field | type | required | description |
| --- | --- | --- | --- |
| properties | object | yes | Map of contact property values to set. |
| properties.email | string | yes | Primary email address of the contact. |
| properties.firstname | string | no | First name of the contact. |
| properties.lastname | string | no | Last name of the contact. |
| properties.phone | string | no | Phone number of the contact. |

### Response

| field | type | description |
| --- | --- | --- |
| id | string | Identifier of the created contact. |
| createdAt | string | Timestamp at which the contact was created. |
| archived | boolean | Whether the contact is archived. |

## Search Contacts

`POST https://api.hubapi.com/crm/v3/objects/contacts/search`

Searches contacts by property value, for example to find a contact by email
address before creating a duplicate.

### Authentication

Bearer token issued to a private app.

### Permissions

- crm.objects.contacts.read

### Request body

| field | type | required | description |
| --- | --- | --- | --- |
| filterGroups | array | yes | Groups of property filters combined with OR. |
| limit | integer | no | Maximum number of results to return. |

### Response

| field | type | description |
| --- | --- | --- |
| total | integer | Total number of matching contacts. |
| results | array | Matching contact records. |
