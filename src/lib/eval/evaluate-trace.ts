import type { ExecutionTrace, StepResult } from '@/types/execution';

/**
 * Rule-based pass/fail check on an already-computed ExecutionTrace. No LLM,
 * no judgment calls beyond what the engine and validator already recorded —
 * this reads `StepResult.status`/`finalStatus`/`issues`, it doesn't re-derive
 * anything. The "evaluator" box on the architecture diagram; a real
 * (LLM- or metric-driven) evaluator is future scope, this is the floor.
 */

export interface StepEvaluation {
  stepId: string;
  passed: boolean;
  reasons: string[];
}

export interface TraceEvaluation {
  passed: boolean;
  stepEvaluations: StepEvaluation[];
  summary: string;
}

function evaluateStep(step: StepResult): StepEvaluation {
  const reasons: string[] = [];

  if (step.status !== 'success') {
    reasons.push(`status is "${step.status}", expected "success"`);
  }
  if (step.finalStatus !== null && (step.finalStatus < 200 || step.finalStatus >= 300)) {
    reasons.push(`final HTTP status ${step.finalStatus} is not 2xx`);
  }
  for (const issue of step.issues) {
    if (issue.severity === 'error') reasons.push(`${issue.code}: ${issue.message}`);
  }

  return { stepId: step.stepId, passed: reasons.length === 0, reasons };
}

export function evaluateTrace(trace: ExecutionTrace): TraceEvaluation {
  const stepEvaluations = trace.steps.map(evaluateStep);
  const failedSteps = stepEvaluations.filter((s) => !s.passed).length;
  const passed = trace.status === 'success' && failedSteps === 0;

  const summary =
    stepEvaluations.length === 0
      ? 'No steps to evaluate.'
      : passed
        ? `All ${stepEvaluations.length} step(s) succeeded with no blocking issues.`
        : `${failedSteps} of ${stepEvaluations.length} step(s) failed or reported a blocking issue.`;

  return { passed, stepEvaluations, summary };
}
