import { redirect } from "next/navigation";

// Old job links open the job in the Openjutsu history.
export default async function OldJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/openjutsu?job=${encodeURIComponent(id)}`);
}
