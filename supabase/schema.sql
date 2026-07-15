-- Do It Laaaaaater cloud schema
-- Run this file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists categories_user_name_unique
  on public.categories (user_id, lower(name));

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('link', 'text', 'image_group')),
  title text not null check (char_length(title) between 1 and 300),
  url text,
  normalized_url text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists items_id_user_unique
  on public.items (id, user_id);

create unique index if not exists items_user_url_unique
  on public.items (user_id, normalized_url)
  where kind = 'link' and normalized_url is not null;

create index if not exists items_user_status_date
  on public.items (user_id, status, created_at desc);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('web_cover', 'attachment', 'gallery')),
  original_name text not null,
  original_path text not null unique,
  thumb_path text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size bigint not null check (size between 1 and 20971520),
  width integer,
  height integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (item_id, user_id) references public.items(id, user_id) on delete cascade
);

create index if not exists assets_item_order
  on public.assets (item_id, role, sort_order);

alter table public.app_owner enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.assets enable row level security;

drop policy if exists "owner can read app owner" on public.app_owner;
create policy "owner can read app owner"
  on public.app_owner for select
  using ((select auth.uid()) = user_id);

drop policy if exists "owner manages categories" on public.categories;
create policy "owner manages categories"
  on public.categories for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages items" on public.items;
create policy "owner manages items"
  on public.items for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages assets" on public.assets;
create policy "owner manages assets"
  on public.assets for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.is_setup_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.app_owner);
$$;

revoke all on function public.is_setup_required() from public;
grant execute on function public.is_setup_required() to anon, authenticated;

create or replace function public.claim_first_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_owner (singleton, user_id, email)
  values (true, new.id, coalesce(new.email, ''));

  insert into public.categories (user_id, name, color, sort_order)
  values
    (new.id, '工作', '#2563eb', 0),
    (new.id, '技术', '#7c3aed', 1),
    (new.id, '资讯', '#0891b2', 2),
    (new.id, '灵感', '#d97706', 3),
    (new.id, '生活', '#16a34a', 4),
    (new.id, '其他', '#64748b', 5);

  return new;
exception
  when unique_violation then
    raise exception 'Do It Laaaaaater 已经有唯一账号';
end;
$$;

drop trigger if exists on_auth_user_created_claim_owner on auth.users;
create trigger on_auth_user_created_claim_owner
  after insert on auth.users
  for each row execute function public.claim_first_owner();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'library-images',
  'library-images',
  false,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner reads library images" on storage.objects;
create policy "owner reads library images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'library-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner uploads library images" on storage.objects;
create policy "owner uploads library images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'library-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner updates library images" on storage.objects;
create policy "owner updates library images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'library-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'library-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner deletes library images" on storage.objects;
create policy "owner deletes library images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'library-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
