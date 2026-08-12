/**
 * Client-safe BWF helpers only (no Next cache / Supabase).
 * Server catalog loaders live in `catalog.ts` (import "server-only").
 */
export {
  cleanEventName,
  cleanPlayerName,
  displayDate,
  formatDuration,
  formatScoreLine,
  formatTeam,
  playerIdFromName,
  playerWon,
  matchInvolvesPlayer,
  opponentNames,
  roundRank,
} from "./parse";

export { playerImageUrl, teamInitials } from "./player-image";

export { parseYoutubeUrl, isAllowlistedYoutubeUrl } from "./youtube";

export {
  filterMatches,
  formSortMatches,
  matchChronologyMs,
  h2hFromMatches,
  isH2hMeeting,
  paginateMatches,
  sortMatches,
  winRateFromRecord,
  buildSearchHits,
  buildStaticSearchIndex,
  buildCatalogStats,
  playerSearchHit,
  eventSearchHit,
  matchSearchHit,
  aggregatePlayers,
  toDirectoryPlayer,
  topPlayersFromList,
} from "./query";

export {
  BWF_SEARCH_LIMIT,
  BWF_SEARCH_MAX_Q,
  BWF_STATUS_LABEL,
  BWF_STATUS_LABEL_LONG,
  BWF_STATUS_UI,
  DISCS,
  DISC_LABEL,
} from "./types";

export type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  DirectoryPlayer,
  Disc,
  GameScore,
  H2hPickerPlayer,
  HomeStats,
  MatchFilters,
  MatchStatus,
  SearchHit,
} from "./types";
