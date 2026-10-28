import { Suspense } from "react";
import { InviteForm } from "./InviteForm";

export const metadata = { title: "Susano · Private preview" };

export default function Invite() {
  return (
    <div className="invite">
      <main className="invite-card glass">
        <div className="brand">Susano</div>
        <h1>Private preview</h1>
        <p>An open-weights creative studio on ComfyUI. Enter your invite code to try Openjutsu, Tsukuyomi, Cinematic and Influencer.</p>
        <Suspense>
          <InviteForm />
        </Suspense>
        <p className="fine">
          Safe mode is on: uploads and prompts are checked before anything is generated.{" "}
          <a href="https://github.com/norioversoul/susano" target="_blank" rel="noreferrer">Source on GitHub</a>
        </p>
      </main>
    </div>
  );
}
