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
  normalizeCountry,
  normalizePlayerKey,
  playerIdFromName,
  playerIdBase,
  playerIdCountry,
  formatCountry,
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
  pairH2hFromMatches,
  isPairH2hMeeting,
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
  thisWeekMatches,
  utcIsoWeekStart,
  scoreKind,
  resultChip,
  gamesWon,
  sameFormBand,
  classifyRivals,
  applyRating,
  inferUniqueCountries,
  applyInferredCountries,
  resolvePlayerId,
  pickPlayerRating,
  pickPairRating,
  ratingsForPlayer,
} from "./query";

export {
  BWF_SEARCH_LIMIT,
  BWF_SEARCH_MAX_Q,
  BWF_STATUS_LABEL,
  BWF_STATUS_LABEL_LONG,
  BWF_STATUS_UI,
  DISCS,
  DISC_LABEL,
  FORM_BAND,
  OWNS_MIN_MEETINGS,
} from "./types";

export type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  DirectoryPlayer,
  Disc,
  FormRating,
  GameScore,
  H2hPickerPlayer,
  HomeStats,
  MatchFilters,
  MatchStatus,
  RivalRow,
  SearchHit,
} from "./types";
