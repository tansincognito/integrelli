/**
 * Thrown when live mode is requested but the gate fails (missing env vars,
 * an unsatisfiable auth kind, and/or `INTEGRELLI_ALLOW_LIVE` not "true").
 * Shared by both packs' engines (`engine.ts`, `capability-engine.ts`) so a
 * route only ever needs one `instanceof` check regardless of which pack it
 * executes. The route translates this into a 400 with the missing var names.
 */
export class LiveModeGateError extends Error {
  readonly missingEnvVars: string[];
  constructor(message: string, missingEnvVars: string[]) {
    super(message);
    this.name = 'LiveModeGateError';
    this.missingEnvVars = missingEnvVars;
  }
}
