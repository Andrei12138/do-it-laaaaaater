-- Do It Laaaaaater: one synchronized memo canvas per account.
-- Incremental only: existing accounts, categories, items and images are unchanged.

create table if not exists public.memo_canvas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scene_json jsonb not null default '{"elements":[],"appState":{}}'::jsonb,
  background text not null default 'solid'
    check (background in ('solid', 'grid', 'dots', 'lines')),
  color_mode text not null default 'light'
    check (color_mode in ('light', 'dark')),
  updated_at timestamptz not null default now()
);

create table if not exists public.memo_assets (
  file_id text not null check (file_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size bigint not null check (size between 1 and 20971520),
  created_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

create index if not exists memo_assets_user_created
  on public.memo_assets (user_id, created_at);

alter table public.memo_canvas enable row level security;
alter table public.memo_assets enable row level security;

drop policy if exists "owner manages memo canvas" on public.memo_canvas;
create policy "owner manages memo canvas"
  on public.memo_canvas for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages memo assets" on public.memo_assets;
create policy "owner manages memo assets"
  on public.memo_assets for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memo-canvas-images',
  'memo-canvas-images',
  false,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner reads memo canvas images" on storage.objects;
create policy "owner reads memo canvas images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'memo-canvas-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner uploads memo canvas images" on storage.objects;
create policy "owner uploads memo canvas images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memo-canvas-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner updates memo canvas images" on storage.objects;
create policy "owner updates memo canvas images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'memo-canvas-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'memo-canvas-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner deletes memo canvas images" on storage.objects;
create policy "owner deletes memo canvas images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'memo-canvas-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
