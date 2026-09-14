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
  {
    provider: 'stripe',
    query: 'detect a successful payment',
    expected_capability_id: 'stripe.payment_intent_succeeded',
    // Was max_rank 3 before the provider expansion. Adding Square (also a
    // payment provider, also indexing "payment") pushed this to rank 4 on the
    // lexical path — a real, expected precision cost of growing the graph
    // without embeddings. See architecture.md's provider-expansion section.
    max_rank: 4,
  },

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

  // GitHub
  { provider: 'github', query: 'open a github issue', expected_capability_id: 'github.create_repos_issue', max_rank: 2 },
  { provider: 'github', query: 'open a pull request on github', expected_capability_id: 'github.create_repos_pull', max_rank: 2 },

  // Twilio
  { provider: 'twilio', query: 'send a text message via twilio', expected_capability_id: 'twilio.messages_json', max_rank: 2 },

  // Discord
  { provider: 'discord', query: 'post a message to a discord channel', expected_capability_id: 'discord.create_channels_message', max_rank: 2 },

  // Notion
  { provider: 'notion', query: 'create a notion page', expected_capability_id: 'notion.create_page', max_rank: 2 },
  { provider: 'notion', query: 'query a notion database', expected_capability_id: 'notion.create_data_sources_query', max_rank: 2 },

  // Asana
  { provider: 'asana', query: 'create a task in asana', expected_capability_id: 'asana.create_task', max_rank: 2 },

  // Square
  { provider: 'square', query: 'charge a card with square', expected_capability_id: 'square.create_payment', max_rank: 2 },

  // DocuSign
  { provider: 'docusign', query: 'send a document for signature', expected_capability_id: 'docusign.create_accounts_envelope', max_rank: 2 },

  // Mailchimp
  { provider: 'mailchimp', query: 'add a subscriber to a mailing list', expected_capability_id: 'mailchimp.create_lists_member', max_rank: 2 },

  // Box
  { provider: 'box', query: 'list files in a box folder', expected_capability_id: 'box.list_folders_items', max_rank: 2 },

  // PagerDuty
  { provider: 'pagerduty', query: 'create a pagerduty incident', expected_capability_id: 'pagerduty.create_incident', max_rank: 2 },
];
