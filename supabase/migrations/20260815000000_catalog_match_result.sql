-- Walkovers and retirements stay in the catalog (they happened) but are
-- not used for form ratings. `result` is the wiki outcome; `winner_side`
-- is who advanced when that can be determined (bold / games-won).

alter table public.matches
  add column if not exists result text
    check (result in ('completed', 'walkover', 'retired', 'incomplete'));

alter table public.matches
  add column if not exists winner_side smallint
    check (winner_side in (1, 2));

comment on column public.matches.result is
  'Wiki outcome. Walkover/retired rows are stored; ratings.clean_matches drops them.';
comment on column public.matches.winner_side is
  '1 or 2 when the advancing side is known (including walkover winner).';
