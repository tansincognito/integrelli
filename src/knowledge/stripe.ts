import type { EndpointSpec } from '@/types/endpoint';

const BASE_URL = 'https://api.stripe.com';

/**
 * Stripe's REST API takes form-encoded (application/x-www-form-urlencoded)
 * request bodies, not JSON, including bracket notation for nested/array
 * fields (e.g. "line_items[0][price]"). requestSchema below still describes
 * the logical field shape; compose/live-adapter are responsible for
 * form-encoding it on the wire.
 */
const FORM_ENCODED_NOTE =
  'Body is application/x-www-form-urlencoded, not JSON. Nested/array fields use bracket notation (e.g. line_items[0][price]).';

export const STRIPE_ENDPOINTS: EndpointSpec[] = [
  {
    id: 'stripe.create_payment_link',
    service: 'stripe',
    serviceLabel: 'Stripe',
    apiVersion: '2024-06-20',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/payment_links',
    auth: { kind: 'bearer', envVar: 'STRIPE_API_KEY' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    params: [],
    requestSchema: {
      type: 'object',
      required: ['line_items'],
      description: FORM_ENCODED_NOTE,
      properties: {
        line_items: {
          type: 'array',
          description: 'Array of {price, quantity} line items (form-encoded as line_items[0][price] etc).',
          items: {
            type: 'object',
            required: ['price', 'quantity'],
            properties: {
              price: { type: 'string', description: 'Price ID, e.g. price_1PxxxAbc.' },
              quantity: { type: 'integer', minimum: 1 },
            },
          },
        },
        after_completion: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['redirect', 'hosted_confirmation'] },
          },
        },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['id', 'object', 'url', 'active'],
      properties: {
        id: { type: 'string' },
        object: { type: 'string', enum: ['payment_link'] },
        active: { type: 'boolean' },
        url: { type: 'string', format: 'uri' },
        currency: { type: 'string' },
        livemode: { type: 'boolean' },
      },
    },
    exampleResponse: {
      id: 'plink_1PxQ2rAbCdEfGhIj',
      object: 'payment_link',
      active: true,
      url: 'https://buy.stripe.com/test_9AQ3fL8kY7pV1QM3cc',
      currency: 'usd',
      livemode: false,
    },
    description: 'Create a shareable, hosted Stripe payment link for one or more prices.',
    keywords: ['payment link', 'checkout', 'invoice', 'billing', 'charge', 'payment'],
    docsUrl: 'https://docs.stripe.com/api/payment_links/payment_links/create',
  },
  {
    id: 'stripe.create_customer',
    service: 'stripe',
    serviceLabel: 'Stripe',
    apiVersion: '2024-06-20',
    method: 'POST',
    baseUrl: BASE_URL,
    path: '/v1/customers',
    auth: { kind: 'bearer', envVar: 'STRIPE_API_KEY' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    params: [],
    requestSchema: {
      type: 'object',
      description: FORM_ENCODED_NOTE,
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
        description: { type: 'string' },
        phone: { type: 'string' },
      },
    },
    responseSchema: {
      type: 'object',
      required: ['id', 'object'],
      properties: {
        id: { type: 'string' },
        object: { type: 'string', enum: ['customer'] },
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
        created: { type: 'integer' },
        livemode: { type: 'boolean' },
      },
    },
    exampleResponse: {
      id: 'cus_QaB1c2D3e4F5g6',
      object: 'customer',
      email: 'jane@example.com',
      name: 'Jane Doe',
      created: 1716239022,
      livemode: false,
    },
    description: 'Create a new customer record in Stripe.',
    keywords: ['customer', 'create customer', 'billing profile', 'contact'],
    docsUrl: 'https://docs.stripe.com/api/customers/create',
  },
  {
    id: 'stripe.retrieve_payment_intent',
    service: 'stripe',
    serviceLabel: 'Stripe',
    apiVersion: '2024-06-20',
    method: 'GET',
    baseUrl: BASE_URL,
    path: '/v1/payment_intents/:payment_intent_id',
    auth: { kind: 'bearer', envVar: 'STRIPE_API_KEY' },
    headers: {},
    params: [
      {
        name: 'payment_intent_id',
        location: 'path',
        required: true,
        type: 'string',
        description: 'ID of the PaymentIntent to retrieve.',
        example: 'pi_3PxQ2rAbCdEfGhIj0k1L2m3N',
      },
    ],
    requestSchema: null,
    responseSchema: {
      type: 'object',
      required: ['id', 'object', 'amount', 'currency', 'status'],
      properties: {
        id: { type: 'string' },
        object: { type: 'string', enum: ['payment_intent'] },
        amount: { type: 'integer', description: 'Amount in the smallest currency unit (e.g. cents).' },
        currency: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'requires_payment_method',
            'requires_confirmation',
            'requires_action',
            'processing',
            'requires_capture',
            'canceled',
            'succeeded',
          ],
        },
        customer: { type: 'string' },
      },
    },
    exampleResponse: {
      id: 'pi_3PxQ2rAbCdEfGhIj0k1L2m3N',
      object: 'payment_intent',
      amount: 2000,
      currency: 'usd',
      status: 'succeeded',
      customer: 'cus_QaB1c2D3e4F5g6',
    },
    description: 'Retrieve a PaymentIntent by id to check its current status and amount.',
    keywords: ['payment intent', 'charge status', 'payment status', 'retrieve payment'],
    docsUrl: 'https://docs.stripe.com/api/payment_intents/retrieve',
  },
];
