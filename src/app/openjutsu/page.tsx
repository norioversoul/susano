import type { Metadata } from "next";
import { Workspace, type Tab } from "./Workspace";

export const metadata: Metadata = { title: "Openjutsu · Susano" };

const TABS: Tab[] = ["history", "how"];

export default async function OpenjutsuPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = (TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "history";
  return <Workspace initialTab={sp.job ? "history" : tab} focus={sp.job ?? null} />;
}
