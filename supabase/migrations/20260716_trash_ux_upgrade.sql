-- Do It Laaaaaater recycle-bin upgrade
-- Safe and repeatable: existing accounts, items, categories and images remain unchanged.

alter table public.items
  add column if not exists trashed_at timestamptz;

create index if not exists items_user_trash
  on public.items (user_id, trashed_at, created_at desc);

comment on column public.items.trashed_at is
  'Soft-delete timestamp. Null means active; trashed items are permanently removed after seven days.';
