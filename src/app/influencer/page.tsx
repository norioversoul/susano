import type { Metadata } from "next";
import { Influencer, type Tab } from "./Influencer";

export const metadata: Metadata = { title: "Influencer · Susano" };

const TABS: Tab[] = ["characters", "photos", "videos", "how"];

export default async function InfluencerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <Influencer initialTab={(TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "characters"} />;
}
