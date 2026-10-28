import { NextResponse } from "next/server";
import { advanceDream, dreams } from "@/lib/dream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dreams whose next job is being submitted, so overlapping polls never submit it twice.
const advancing = new Set<string>();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let dream = await dreams.get(id);
  if (!dream) return NextResponse.json({ error: "Dream not found." }, { status: 404 });
  if (dream.status === "completed" || dream.status === "failed" || advancing.has(id)) return NextResponse.json(dream);

  advancing.add(id);
  try {
    dream = (await dreams.update(id, await advanceDream(dream))) ?? dream;
  } catch (e) {
    // Network hiccups must not end the dream; the next poll retries.
    return NextResponse.json({ ...dream, warning: e instanceof Error ? e.message : String(e) });
  } finally {
    advancing.delete(id);
  }
  return NextResponse.json(dream);
}

/** Wake up: finish the segment being made, then stop. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dream = await dreams.update(id, { wake: true });
  if (!dream) return NextResponse.json({ error: "Dream not found." }, { status: 404 });
  return NextResponse.json(dream);
}
