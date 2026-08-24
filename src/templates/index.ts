import { WorkflowPlanSchema } from '@/schemas/workflow.zod';
import type { WorkflowPlan } from '@/types/workflow';
import elevenlabsStripeGmail from './elevenlabs-stripe-gmail.json';
import callToNotionSlack from './call-to-notion-slack.json';
import stripeReceiptSms from './stripe-receipt-sms.json';
import openaiSummaryEmail from './openai-summary-email.json';

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  plan: WorkflowPlan;
}

interface RawTemplateFile {
  id: string;
  name: string;
  description: string;
  plan: unknown;
}

const RAW_TEMPLATES: RawTemplateFile[] = [
  elevenlabsStripeGmail as RawTemplateFile,
  callToNotionSlack as RawTemplateFile,
  stripeReceiptSms as RawTemplateFile,
  openaiSummaryEmail as RawTemplateFile,
];

/** Parses every builtin template through the real plan Zod schema at import time, so a bad template fails loudly at startup. */
function parseTemplate(raw: RawTemplateFile): BuiltinTemplate {
  const plan = WorkflowPlanSchema.parse(raw.plan) as WorkflowPlan;
  return { id: raw.id, name: raw.name, description: raw.description, plan };
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = RAW_TEMPLATES.map(parseTemplate);
