import { notFound } from "next/navigation";
import { PlayerProfile } from "@/components/bwf/player-profile";
import { PLAYERS } from "@/lib/bwf/data";

export function generateStaticParams() {
  return PLAYERS.map((p) => ({ id: p.id }));
}

export default async function BwfPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!PLAYERS.some((p) => p.id === id)) notFound();
  return <PlayerProfile id={id} />;
}
