/**
 * Golden queries — the first regression test for the knowledge layer
 * (architecture.md section 7).
 *
 * Each entry is a natural-language request and the capability that must be
 * retrieved for it. `max_rank` is the position the expected capability must
 * reach, one-based: 1 means it must be the single best match.
 *
 * These run against the lexical scorer in CI (no network, no key), which is the
 * weaker of the two retrieval paths. A query that passes lexically will pass
 * with embeddings; the reverse is not true, so this is the honest bar.
 */
export interface GoldenQuery {
  provider: string;
  query: string;
  expected_capability_id: string;
  max_rank: number;
}

export const GOLDEN_QUERIES: GoldenQuery[] = [
  // Stripe
  { provider: 'stripe', query: 'create a payment link', expected_capability_id: 'stripe.create_payment_link', max_rank: 1 },
  { provider: 'stripe', query: 'create a hosted checkout session for a purchase', expected_capability_id: 'stripe.create_checkout_session', max_rank: 2 },
  { provider: 'stripe', query: 'get a customer', expected_capability_id: 'stripe.get_customer', max_rank: 2 },
  { provider: 'stripe', query: 'refund a payment', expected_capability_id: 'stripe.create_refund', max_rank: 2 },
  { provider: 'stripe', query: 'detect a successful payment', expected_capability_id: 'stripe.payment_intent_succeeded', max_rank: 3 },

  // Gmail
  { provider: 'gmail', query: 'send an email', expected_capability_id: 'gmail.send_message', max_rank: 2 },
  { provider: 'gmail', query: 'search the mailbox for an email', expected_capability_id: 'gmail.list_messages', max_rank: 3 },
  { provider: 'gmail', query: 'get an email message by id', expected_capability_id: 'gmail.get_message', max_rank: 3 },
  { provider: 'gmail', query: 'save an email as a draft', expected_capability_id: 'gmail.create_draft', max_rank: 2 },

  // Slack
  { provider: 'slack', query: 'post a message to a slack channel', expected_capability_id: 'slack.chat_post_message', max_rank: 2 },
  { provider: 'slack', query: 'find a slack channel by name', expected_capability_id: 'slack.conversations_list', max_rank: 2 },

  // ElevenLabs
  { provider: 'elevenlabs', query: 'convert text into speech audio', expected_capability_id: 'elevenlabs.text_to_speech', max_rank: 2 },
  { provider: 'elevenlabs', query: 'list the available voices', expected_capability_id: 'elevenlabs.list_voices', max_rank: 2 },

  // HubSpot
  { provider: 'hubspot', query: 'create a crm contact', expected_capability_id: 'hubspot.create_contact', max_rank: 2 },
  { provider: 'hubspot', query: 'search contacts by email address', expected_capability_id: 'hubspot.search_contacts', max_rank: 2 },
];
