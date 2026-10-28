import type { Metadata } from "next";
import { Dreamer, type Tab } from "./Dreamer";

export const metadata: Metadata = { title: "Tsukuyomi · Susano" };

const TABS: Tab[] = ["dreams", "how"];

export default async function TsukuyomiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = (TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "dreams";
  return <Dreamer initialTab={sp.dream ? "dreams" : tab} focus={sp.dream ?? null} />;
}
