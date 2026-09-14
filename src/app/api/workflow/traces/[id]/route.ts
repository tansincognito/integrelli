import { NextResponse } from 'next/server';
import { getTraceRecord } from '@/lib/storage/trace-store';

export const runtime = 'nodejs';

/** GET /api/workflow/traces/:id — the full stored record (trace + plan + evaluation) for one run. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const record = await getTraceRecord(id);
  if (!record) {
    return NextResponse.json({ error: `No trace recorded with id "${id}".` }, { status: 404 });
  }
  return NextResponse.json(record);
}
