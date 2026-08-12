import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MatchViewer } from "@/components/match-viewer/match-viewer";
import { getMatchById } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import { formatTeam, parseYoutubeUrl } from "@/lib/bwf/data";
import type { CatalogMatch } from "@/lib/bwf/types";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const m = await getMatchById(id);
    if (!m) return { title: "Match viewer" };
    return {
      title: `${formatTeam(m.team1)} vs ${formatTeam(m.team2)} · Match viewer`,
      description: `${m.event}${m.round ? ` · ${m.round}` : ""} — broadcast + demo 3D scrubber`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: "Match viewer" };
  }
}

export default async function CatalogMatchViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let match: CatalogMatch | null = null;
  let error: string | null = null;

  try {
    match = await getMatchById(id);
  } catch (err) {
    error = catalogUserError(err, "match-viewer");
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--bg-base)] px-6 text-center">
        <div>
          <p className="font-display text-lg text-[var(--text-strong)]">
            Could not load match
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{error}</p>
        </div>
      </div>
    );
  }
  if (!match) notFound();

  const youtube = parseYoutubeUrl(match.sourceUrl);
  const title = `${formatTeam(match.team1)} vs ${formatTeam(match.team2)}`;
  const event = [match.event, match.round].filter(Boolean).join(" · ");

  return (
    <MatchViewer
      matchId={match.id}
      youtubeId={youtube?.id ?? null}
      title={title}
      event={event}
      playerAName={formatTeam(match.team1)}
      playerBName={formatTeam(match.team2)}
      backHref={`/bwf/matches/${match.id}`}
      backLabel="Back to match"
      demoAnalysis
    />
  );
}
