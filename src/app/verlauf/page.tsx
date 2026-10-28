import { redirect } from "next/navigation";

// The old history page now lives in the Openjutsu workspace.
export default function OldHistory() {
  redirect("/openjutsu?tab=history");
}
