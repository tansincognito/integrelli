import { NextResponse } from 'next/server';
import { listTraceSummaries } from '@/lib/storage/trace-store';

export const runtime = 'nodejs';

/** GET /api/workflow/traces — recorded runs (mock and live), newest first. */
export async function GET(): Promise<NextResponse> {
  const traces = await listTraceSummaries();
  return NextResponse.json({ traces });
}
