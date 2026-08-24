export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { ALL_ENDPOINTS } from '@/knowledge/index';
import type { AuthStyle, ServiceId } from '@/types/endpoint';

function envVarsForAuth(auth: AuthStyle): string[] {
  switch (auth.kind) {
    case 'bearer':
    case 'header':
    case 'query':
      return [auth.envVar];
    case 'basic':
      return [auth.usernameEnvVar, auth.passwordEnvVar];
    default: {
      const exhaustive: never = auth;
      throw new Error(`Unknown auth kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * GET /api/env-status — booleans and missing var NAMES only, never values
 * (DESIGN.md section 7).
 */
export async function GET(): Promise<NextResponse> {
  const allowLive = process.env.INTEGRELLI_ALLOW_LIVE === 'true';

  const varsByService = new Map<ServiceId, Set<string>>();
  for (const endpoint of ALL_ENDPOINTS) {
    const set = varsByService.get(endpoint.service) ?? new Set<string>();
    for (const v of envVarsForAuth(endpoint.auth)) set.add(v);
    varsByService.set(endpoint.service, set);
  }

  const services = {} as Record<ServiceId, { ready: boolean; missing: string[] }>;
  for (const [service, vars] of varsByService) {
    const missing = [...vars].filter((v) => !process.env[v]);
    services[service] = { ready: missing.length === 0, missing };
  }

  return NextResponse.json({ allowLive, services }, { status: 200 });
}
