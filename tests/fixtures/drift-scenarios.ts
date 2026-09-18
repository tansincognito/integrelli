import type { WorkflowPlan } from '@/planner/schema';
import type { DriftScenario, FailureClass } from '@/healing/types';

/**
 * The self-healing eval dataset — the project brief's "Drift scenarios"
 * table: ~15-20 scenarios across the 5 failure classes, scored for
 * detection rate, correct-classification rate, auto-repair rate, and
 * wrong-patch rate (scripts/eval-drift.ts computes these).
 *
 * Currently 13, not the full 15-20: this is a first tranche against the two
 * plans already proven to validate cleanly (tests/self-healing.test.ts,
 * tests/capability-engine.test.ts). Publishing 13 honest scenarios beats
 * padding to 20 with duplicates of the same field on the same plan — see
 * architecture.md's own stance on this (§ "Day 1 Review": real numbers over
 * an inflated headline). Expand by adding more (plan, field) pairs across
 * more provider pairs as they come up.
 */

export const PLAN_PAYMENT_RECEIPT: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'payment-receipt-email',
  description: 'Email a receipt when a Stripe payment succeeds.',
  steps: [
    { id: 'step_1', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect the successful payment.' },
    { id: 'step_2', capability: 'gmail.send_message', purpose: 'Send the confirmation email.' },
  ],
  mappings: [
    { source: 'literal:me', destination: 'step_2.userId' },
    { source: 'step_1.data.object.receipt_email', destination: 'step_2.raw', transform: 'rfc822_base64url' },
    { source: 'step_1.data.object.status', destination: 'step_2.snippet' },
  ],
};

export const PLAN_CUSTOMER_WELCOME: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'customer-welcome-email',
  description: 'Create a Stripe customer and notify them by Gmail.',
  steps: [
    { id: 'step_1', capability: 'stripe.create_customer', purpose: 'Create the customer record.' },
    { id: 'step_2', capability: 'gmail.send_message', purpose: 'Notify the customer by email.' },
  ],
  mappings: [
    { source: 'literal:me', destination: 'step_2.userId' },
    { source: 'step_1.id', destination: 'step_2.threadId' },
    { source: 'step_1.phone', destination: 'step_2.snippet' },
    {
      source: 'literal:To: customer@example.com\r\nSubject: Welcome\r\n\r\nThanks for signing up.',
      destination: 'step_2.raw',
      transform: 'rfc822_base64url',
    },
  ],
};

export interface DriftScenarioFixture {
  plan: WorkflowPlan;
  scenario: DriftScenario;
  /** False for the one negative control: the classifier must report zero findings for it. */
  expectFinding: boolean;
  /** Ground truth for the eval script's correct-classification metric. Ignored when expectFinding is false. */
  expectedClass: FailureClass;
  /** Ground truth for the eval script's auto-repair / wrong-patch metrics. Ignored when expectFinding is false. */
  expectSuccessfulRepair: boolean;
}

export const DRIFT_SCENARIOS: DriftScenarioFixture[] = [
  // --- renamed_field (3) ---
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'renamed_field',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'renamed_field_receipt_email', class: 'renamed_field', stepId: 'step_1',
      field: 'data.object.receipt_email', renameTo: 'receipt_email_address',
      description: 'Stripe renames payment_intent.receipt_email to receipt_email_address.',
    },
  },
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'renamed_field',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'renamed_field_receipt_email_v2', class: 'renamed_field', stepId: 'step_1',
      field: 'data.object.receipt_email', renameTo: 'customer_receipt_email',
      description: 'A second, differently-named rename of the same field.',
    },
  },
  {
    plan: PLAN_CUSTOMER_WELCOME,
    expectFinding: true,
    expectedClass: 'renamed_field',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'renamed_field_phone', class: 'renamed_field', stepId: 'step_1',
      field: 'phone', renameTo: 'phone_number',
      description: 'Stripe renames customer.phone to phone_number.',
    },
  },

  // --- type_change (2) ---
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'type_change',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'type_change_receipt_email', class: 'type_change', stepId: 'step_1',
      field: 'data.object.receipt_email', forceType: 'number',
      description: 'receipt_email starts coming back as a number.',
    },
  },
  {
    plan: PLAN_CUSTOMER_WELCOME,
    expectFinding: true,
    expectedClass: 'type_change',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'type_change_phone', class: 'type_change', stepId: 'step_1',
      field: 'phone', forceType: 'number',
      description: 'phone starts coming back as a number.',
    },
  },

  // --- new_enum_value (2) ---
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'new_enum_value',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'new_enum_disputed', class: 'new_enum_value', stepId: 'step_1',
      field: 'data.object.status', enumValue: 'disputed',
      description: 'Stripe ships a new PaymentIntent status value.',
    },
  },
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'new_enum_value',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'new_enum_pending_review', class: 'new_enum_value', stepId: 'step_1',
      field: 'data.object.status', enumValue: 'pending_review',
      description: 'A second, differently-named new status value.',
    },
  },

  // --- expired_token (3) ---
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'expired_token',
    expectSuccessfulRepair: true,
    scenario: { id: 'expired_token_send', class: 'expired_token', stepId: 'step_2', description: 'Gmail token expired before send.' },
  },
  {
    plan: PLAN_CUSTOMER_WELCOME,
    expectFinding: true,
    expectedClass: 'expired_token',
    expectSuccessfulRepair: true,
    scenario: { id: 'expired_token_welcome', class: 'expired_token', stepId: 'step_2', description: 'Gmail token expired before the welcome email.' },
  },
  {
    plan: PLAN_CUSTOMER_WELCOME,
    expectFinding: true,
    expectedClass: 'expired_token',
    expectSuccessfulRepair: true,
    scenario: { id: 'expired_token_create_customer', class: 'expired_token', stepId: 'step_1', description: 'Stripe API key expired before customer creation.' },
  },

  // --- removed_endpoint (2) — always expected to escalate, never repaired ---
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: true,
    expectedClass: 'removed_endpoint',
    expectSuccessfulRepair: false,
    scenario: { id: 'removed_endpoint_send', class: 'removed_endpoint', stepId: 'step_2', description: 'Gmail send endpoint retired.' },
  },
  {
    plan: PLAN_CUSTOMER_WELCOME,
    expectFinding: true,
    expectedClass: 'removed_endpoint',
    expectSuccessfulRepair: false,
    scenario: { id: 'removed_endpoint_create_customer', class: 'removed_endpoint', stepId: 'step_1', description: 'Stripe create-customer endpoint retired.' },
  },

  // --- negative control (1): not drift at all — the classifier must stay quiet ---
  {
    plan: PLAN_PAYMENT_RECEIPT,
    expectFinding: false,
    expectedClass: 'new_enum_value',
    expectSuccessfulRepair: true,
    scenario: {
      id: 'control_known_enum_value', class: 'new_enum_value', stepId: 'step_1',
      field: 'data.object.status', enumValue: 'processing', // already a real, declared value
      description: 'NEGATIVE CONTROL: not actually a new value — must produce zero findings.',
    },
  },
];
