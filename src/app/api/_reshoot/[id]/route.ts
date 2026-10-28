import { NextResponse } from "next/server";
import { getJob } from "@/lib/reshoot";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getJob(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check job." }, { status: 502 });
  }
}
