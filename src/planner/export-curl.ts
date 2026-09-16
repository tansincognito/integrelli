import type { CapabilityAuthentication, CapabilityInput } from '@/knowledge/capability';
import { loadStore } from '@/knowledge/store';
import type { WorkflowPlan } from './schema';
import type { PlanValidation, ResolvedMapping } from './validator';

/**
 * Renders a compiled plan as a runnable bash script: one curl call per
 * action step, chained with jq so a later step's mapped fields can pull
 * values out of an earlier step's actual JSON response — the same
 * source/destination relationships `resolved_mappings` already describes,
 * just expressed as shell instead of as data. Requires curl and jq.
 *
 * Scoped deliberately: array-shaped fields (HubSpot's `associations`, for
 * instance) are handed to the caller as one JSON blob to fill in by hand
 * rather than reconstructed field-by-field through jq — a general JSON-path-
 * to-jq compiler is a lot of machinery for a case that's already an honest
 * "you need to write this yourself" in the workflow chart. Every other
 * mapping kind (field reference, literal, template, an unmapped required
 * field) is rendered for real.
 */

/**
 * Applies a plan mapping's `transform` to a shell value expression for real —
 * not just a comment noting it should happen. `expr` is either a bare shell
 * literal or a `"$(...)"` command substitution; both forms get unwrapped so
 * the transform's own pipeline becomes the new command substitution body.
 */
function applyShellTransform(expr: string, transform: string | undefined): string {
  if (!transform || transform === 'identity') return expr;

  const wrapped = expr.startsWith('"$(') && expr.endsWith(')"');
  const inner = wrapped ? expr.slice('"$('.length, -')"'.length) : `printf '%s' ${expr}`;

  switch (transform) {
    case 'rfc822_base64url':
      return `"$(${inner} | base64 | tr -d '\\n' | tr '+/' '-_' | tr -d '=')"`;
    case 'to_minor_units':
      return `"$(${inner} | awk '{printf "%d", $1 * 100}')"`;
    case 'to_string':
    case 'json_stringify':
      // jq's --arg already stringifies whatever it's handed; nothing further to do at the shell level.
      return expr;
    default:
      return expr;
  }
}

function shellVarName(stepId: string, path: string): string {
  return `${stepId}_${path.replace(/[[\].]+/g, '_').replace(/_+$/, '')}`.toUpperCase();
}

/** `${PROVIDE_X:?message}` — bash fails loudly with the field's own description if the script is run without filling this in. */
function providePlaceholder(input: CapabilityInput, stepId: string): string {
  const name = `PROVIDE_${shellVarName(stepId, input.path)}`;
  const hint = (input.description ?? `a ${input.type}${input.format ? ` (${input.format})` : ''} value for "${input.path}"`).replace(
    /"/g,
    "'"
  );
  // Quoted: the message contains spaces, and this expression is always used
  // as a single argument (to jq's --arg/--argjson, or inline in a URL) —
  // unquoted, bash would word-split it and corrupt whatever command it's in.
  return `"\${${name}:?Set ${name} — ${hint}}"`;
}

function authForCurl(
  auth: CapabilityAuthentication,
  providerId: string
): { headerLines: string[]; queryParams: Record<string, string>; envVars: string[] } {
  const envVar = auth.env_var_name;
  if (!envVar) return { headerLines: [], queryParams: {}, envVars: [] };

  switch (auth.kind) {
    case 'bearer':
    case 'oauth2':
      return { headerLines: [`Authorization: Bearer $${envVar}`], queryParams: {}, envVars: [envVar] };
    case 'basic':
      return { headerLines: [`Authorization: Basic $${envVar}`], queryParams: {}, envVars: [envVar] };
    case 'header':
      return auth.parameter_name
        ? { headerLines: [`${auth.parameter_name}: $${envVar}`], queryParams: {}, envVars: [envVar] }
        : { headerLines: [], queryParams: {}, envVars: [] };
    case 'query':
      return auth.parameter_name
        ? { headerLines: [], queryParams: { [auth.parameter_name]: `$${envVar}` }, envVars: [envVar] }
        : { headerLines: [], queryParams: {}, envVars: [] };
    case 'none':
      return { headerLines: [], queryParams: {}, envVars: [] };
    default:
      return { headerLines: [], queryParams: {}, envVars: [] };
  }
}

/** A shell expression yielding this mapping's value at run time — a literal, a jq extraction from an earlier step's saved response, or a provide-placeholder. */
function valueExpression(
  mapping: ResolvedMapping | undefined,
  input: CapabilityInput,
  stepId: string,
  responseVarByStep: Map<string, string>
): string {
  if (!mapping) return providePlaceholder(input, stepId);

  if (mapping.source_kind === 'literal') {
    return mapping.source.slice('literal:'.length);
  }

  if (mapping.source_kind === 'template') {
    // Interpolate {step_N.path} placeholders as jq extractions inline, single-quoted body with '"'"' escapes kept simple by using $( ) substitutions per placeholder via a small sed-free approach: build with printf.
    const body = mapping.source.slice('template:'.length);
    const parts: string[] = [];
    let lastIndex = 0;
    for (const match of body.matchAll(/\{(step_\d+)\.([^{}]+)\}/g)) {
      const [full, refStepId, refPath] = match;
      const start = match.index ?? 0;
      parts.push(JSON.stringify(body.slice(lastIndex, start)));
      const responseVar = responseVarByStep.get(refStepId);
      parts.push(responseVar ? `"$(echo "$${responseVar}" | jq -r '.${refPath}')"` : JSON.stringify(full));
      lastIndex = start + full.length;
    }
    parts.push(JSON.stringify(body.slice(lastIndex)));
    // %b (not %s): the static text pieces carry real \n as JSON-escaped
    // literal backslash-n (from JSON.stringify) and need printf to turn them
    // back into actual newlines for the composed message to be valid.
    return `"$(printf '%b' ${parts.join(' ')})"`;
  }

  // field
  const responseVar = mapping.source_step_id ? responseVarByStep.get(mapping.source_step_id) : undefined;
  if (!responseVar || !mapping.source_path) return providePlaceholder(input, stepId);
  return `"$(echo "$${responseVar}" | jq -r '.${mapping.source_path}')"`;
}

export function generateCurlScript(plan: WorkflowPlan, validation: PlanValidation): string {
  const { capabilitiesById, implementationsByCapability } = loadStore();
  const mappingsByStep = new Map<string, ResolvedMapping[]>();
  for (const mapping of validation.resolved_mappings) {
    const list = mappingsByStep.get(mapping.destination_step_id) ?? [];
    list.push(mapping);
    mappingsByStep.set(mapping.destination_step_id, list);
  }

  const lines: string[] = [];
  const allEnvVars = new Set<string>();
  const allPlaceholders = new Set<string>();
  const responseVarByStep = new Map<string, string>();
  const body: string[] = [];

  for (const step of plan.steps) {
    const capability = capabilitiesById.get(step.capability);
    if (!capability) {
      body.push(`# ${step.id}: unknown capability "${step.capability}" — skipped`, '');
      continue;
    }

    if (capability.kind === 'event') {
      // Nothing to call — this step's data arrives as an inbound webhook. It
      // still needs a response variable, because later steps' mappings
      // reference its payload: the script takes it as $1.
      const responseVar = `${step.id.toUpperCase()}_RESPONSE`;
      responseVarByStep.set(step.id, responseVar);
      body.push(
        `# ${step.id}: ${capability.id} — inbound trigger (webhook/event). Pass its JSON payload as this script's first argument.`,
        `${responseVar}=\${1:?Provide the ${step.id} (${capability.id}) event payload as JSON, e.g.: $0 "$(cat event.json)"}`,
        ''
      );
      continue;
    }

    const implementation = (implementationsByCapability.get(capability.id) ?? [])[0];
    if (!implementation) {
      body.push(`# ${step.id}: no recorded implementation for "${capability.id}" — skipped`, '');
      continue;
    }

    const stepMappings = new Map(mappingsByStep.get(step.id)?.map((m) => [m.destination_path, m]) ?? []);
    const { headerLines, queryParams, envVars } = authForCurl(capability.authentication, capability.provider_id);
    envVars.forEach((v) => allEnvVars.add(v));

    let url = implementation.endpoint;
    const extraHeaders = [...headerLines, ...Object.entries(implementation.headers).map(([k, v]) => `${k}: ${v}`)];
    const queryPairs = { ...queryParams };
    const bodyFields: Array<{ input: CapabilityInput; expr: string }> = [];

    for (const input of capability.inputs) {
      const mapping = stepMappings.get(input.path);
      const hasArrayMarker = input.path.includes('[]');
      const hasDot = input.path.includes('.');

      // Array-shaped paths are never individually assigned (see module doc) —
      // covered only via their top-level ancestor's own placeholder below.
      if (hasArrayMarker) continue;

      if (input.location === 'body' && hasDot) {
        // A nested (non-array) field only gets its own jq entry when it is
        // itself exactly mapped and its top-level ancestor isn't (which
        // would make this one redundant) — jq auto-creates the parent
        // object, so e.g. mapping only properties.email still produces a
        // correct properties: { email: ... } body with no entry needed for
        // properties itself.
        if (!mapping) continue;
        if (stepMappings.has(input.path.split('.')[0])) continue;
      } else if (!mapping && !input.required) {
        continue;
      } else if (!mapping && input.required && input.location === 'body') {
        // No exact mapping on this top-level field. If a nested descendant
        // of it IS mapped, that entry (above) already covers it.
        const coveredByDescendant = capability.inputs.some(
          (other) =>
            other !== input &&
            other.path.startsWith(`${input.path}.`) &&
            !other.path.includes('[]') &&
            stepMappings.has(other.path)
        );
        if (coveredByDescendant) continue;
      }

      const rawExpr = valueExpression(mapping, input, step.id, responseVarByStep);
      if (rawExpr.includes('${PROVIDE_')) allPlaceholders.add(rawExpr);
      const expr = applyShellTransform(rawExpr, mapping?.transform);

      if (input.location === 'path') {
        url = url.replace(`{${input.path}}`, expr.startsWith('"') ? expr.slice(1, -1) : expr);
      } else if (input.location === 'query') {
        queryPairs[input.path] = expr;
      } else if (input.location === 'header') {
        extraHeaders.push(`${input.path}: ${expr}`);
      } else {
        bodyFields.push({ input, expr });
      }
    }

    if (Object.keys(queryPairs).length > 0) {
      const qs = Object.entries(queryPairs)
        .map(([k, v]) => `${encodeURIComponent(k)}=${v}`)
        .join('&');
      url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
    }

    body.push(`# ${step.id}: ${capability.id} — ${capability.description}`);

    const responseVar = `${step.id.toUpperCase()}_RESPONSE`;
    responseVarByStep.set(step.id, responseVar);

    // Double-quoted, not single: headers and the URL routinely carry a
    // $ENV_VAR reference or a "$(jq ...)" extraction that must actually
    // expand — single quotes would send the literal text "$HUBSPOT_..."
    // instead of the credential.
    const curlLines = [`${responseVar}=$(curl -sS -X ${implementation.method ?? 'POST'} \\`, `  "${url}" \\`];
    const hasContentType = extraHeaders.some((h) => h.toLowerCase().startsWith('content-type:'));
    for (const header of extraHeaders) curlLines.push(`  -H "${header}" \\`);

    if (bodyFields.length > 0) {
      if (!hasContentType) curlLines.push(`  -H "Content-Type: application/json" \\`);
      const jqArgs: string[] = [];
      const jqSets: string[] = [];
      bodyFields.forEach(({ input, expr }, index) => {
        const argName = `f${index}`;
        const isScalar = ['string', 'number', 'integer', 'boolean'].includes(input.type);
        jqArgs.push(isScalar ? `--arg ${argName} ${expr}` : `--argjson ${argName} ${expr}`);
        jqSets.push(`.${input.path} = $${argName}`);
      });
      curlLines.push(`  -d "$(jq -n ${jqArgs.join(' ')} '${jqSets.join(' | ')}')" \\`);
    }
    curlLines.push('  -w \'\\nHTTP %{http_code}\\n\')');

    body.push(...curlLines, `echo "$${responseVar}"`, '');
  }

  lines.push(
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `# ${plan.name}`,
    `# ${plan.description}`,
    '#',
    '# Generated from a compiled Integrelli workflow plan. Requires: curl, jq.',
    allPlaceholders.size > 0
      ? '# Variables below marked PROVIDE_* are not derivable from any earlier step —\n' +
        '# the script fails immediately with a description of what each one needs\n' +
        '# until you export them.'
      : '',
    ''
  );

  if (allEnvVars.size > 0) {
    lines.push('# Credentials:');
    for (const envVar of allEnvVars) lines.push(`: "\${${envVar}:?Set ${envVar} in your environment before running this script.}"`);
    lines.push('');
  }

  lines.push(...body.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
