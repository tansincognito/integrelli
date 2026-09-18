import { validatePlan } from '@/planner/validator';
import { runSelfHealing } from '@/healing/repair-loop';
import { DRIFT_SCENARIOS } from '../tests/fixtures/drift-scenarios';
import type { FailureClass } from '@/healing/types';

/**
 * `npm run eval:drift` — the project brief's "Drift scenarios" evaluation:
 * detection rate, correct-classification rate, auto-repair rate, and
 * wrong-patch rate, computed over tests/fixtures/drift-scenarios.ts.
 *
 * Deliberately not a test file: this prints the numbers the brief asks be
 * *published*, honest or not, rather than asserting they clear some bar.
 */

const CLASSES: FailureClass[] = ['renamed_field', 'new_enum_value', 'type_change', 'expired_token', 'removed_endpoint'];

interface Tally {
  total: number;
  detected: number;
  correctClass: number;
  autoRepaired: number;
  escalated: number;
  wrongPatch: number;
}

function emptyTally(): Tally {
  return { total: 0, detected: 0, correctClass: 0, autoRepaired: 0, escalated: 0, wrongPatch: 0 };
}

async function main(): Promise<void> {
  const overall = emptyTally();
  const byClass = new Map<FailureClass, Tally>(CLASSES.map((c) => [c, emptyTally()]));
  let controlFalsePositives = 0;
  let controlTotal = 0;

  for (const fixture of DRIFT_SCENARIOS) {
    const validation = validatePlan(fixture.plan);
    const result = await runSelfHealing(
      fixture.plan,
      validation,
      { seed: 'eval-drift', mode: 'test', faults: [], driftScenarios: [fixture.scenario] },
      fixture.scenario
    );

    if (!fixture.expectFinding) {
      controlTotal += 1;
      if (result.attempts.length > 0) controlFalsePositives += 1;
      const status = result.attempts.length === 0 ? 'PASS' : 'FAIL (false positive)';
      console.log(`[control] ${fixture.scenario.id.padEnd(30)} ${status}`);
      continue;
    }

    const tally = byClass.get(fixture.expectedClass)!;
    tally.total += 1;
    overall.total += 1;

    // A scenario can yield more than one finding (e.g. two mappings drift on
    // the same trace); score against the one whose class matches this
    // scenario's own injected class, since that's the one it's testing.
    const relevant = result.attempts.find((a) => a.classification.class === fixture.expectedClass) ?? result.attempts[0];

    const detected = result.attempts.length > 0;
    const correctClass = relevant?.classification.class === fixture.expectedClass;
    const outcome = relevant?.outcome;

    if (detected) {
      tally.detected += 1;
      overall.detected += 1;
    }
    if (detected && correctClass) {
      tally.correctClass += 1;
      overall.correctClass += 1;
    }
    if (outcome === 'auto_repaired') {
      tally.autoRepaired += 1;
      overall.autoRepaired += 1;
    } else if (outcome === 'escalated') {
      tally.escalated += 1;
      overall.escalated += 1;
    } else if (outcome === 'wrong_patch') {
      tally.wrongPatch += 1;
      overall.wrongPatch += 1;
    }

    const expectedOutcome = fixture.expectSuccessfulRepair ? 'auto_repaired' : 'escalated';
    const ok = detected && correctClass && outcome === expectedOutcome;
    console.log(
      `[${fixture.expectedClass.padEnd(15)}] ${fixture.scenario.id.padEnd(30)} ` +
        `detected=${detected ? 'y' : 'n'} class=${correctClass ? 'y' : 'n'} outcome=${outcome ?? 'none'} ` +
        `${ok ? 'PASS' : 'CHECK'}`
    );
  }

  console.log('\n=== Per-class ===');
  console.log('class'.padEnd(15), 'n', 'detect%', 'classify%', 'repair%', 'wrong-patch%');
  for (const c of CLASSES) {
    const t = byClass.get(c)!;
    if (t.total === 0) continue;
    console.log(
      c.padEnd(15),
      String(t.total).padEnd(3),
      `${((t.detected / t.total) * 100).toFixed(0)}%`.padEnd(8),
      `${((t.correctClass / t.total) * 100).toFixed(0)}%`.padEnd(10),
      `${((t.autoRepaired / t.total) * 100).toFixed(0)}%`.padEnd(8),
      `${((t.wrongPatch / t.total) * 100).toFixed(0)}%`
    );
  }

  console.log('\n=== Overall ===');
  console.log(`Scenarios: ${overall.total}`);
  console.log(`Detection rate: ${((overall.detected / overall.total) * 100).toFixed(1)}%`);
  console.log(`Correct-classification rate: ${((overall.correctClass / overall.total) * 100).toFixed(1)}%`);
  console.log(`Auto-repair rate: ${((overall.autoRepaired / overall.total) * 100).toFixed(1)}%`);
  console.log(`Escalation rate: ${((overall.escalated / overall.total) * 100).toFixed(1)}%`);
  console.log(`Wrong-patch rate: ${((overall.wrongPatch / overall.total) * 100).toFixed(1)}%`);
  if (controlTotal > 0) {
    console.log(`\nNegative controls: ${controlTotal - controlFalsePositives}/${controlTotal} correctly produced no finding.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
