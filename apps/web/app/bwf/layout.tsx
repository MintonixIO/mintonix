import type { Metadata } from "next";
import { BwfShell } from "@/components/bwf/shell";
import { getCatalogPlayers, getCatalogStats } from "@/lib/bwf/catalog";
import type { SearchHit } from "@/lib/bwf/types";

export const metadata: Metadata = {
  title: "BWF match library",
  description:
    "Browse finished BWF matches from the Mintonix catalog — scores, players, tournaments, and video links.",
};

export const revalidate = 300;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  let searchIndex: SearchHit[] = [];
  try {
    const [players, stats] = await Promise.all([
      getCatalogPlayers(),
      getCatalogStats(),
    ]);
    const playerHits: SearchHit[] = players.slice(0, 80).map((p) => ({
      kind: "Player",
      id: p.id,
      label: p.name,
      sub: `${p.matches} matches · ${p.winRate}%${p.disc ? ` · ${p.disc}` : ""}`,
      href: `/bwf/players/${p.id}`,
    }));
    const eventHits: SearchHit[] = stats.events.slice(0, 40).map((e) => ({
      kind: "Tournament",
      id: e.event,
      label: e.event,
      sub: `${e.count} matches`,
      href: `/bwf/matches?event=${encodeURIComponent(e.event)}`,
    }));
    searchIndex = [...playerHits, ...eventHits];
  } catch {
    searchIndex = [];
  }

  return <BwfShell searchIndex={searchIndex}>{children}</BwfShell>;
}
