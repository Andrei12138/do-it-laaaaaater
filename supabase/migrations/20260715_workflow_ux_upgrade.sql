-- Do It Laaaaaater workflow UX upgrade
-- Safe, repeatable migration for an existing Supabase project.
-- It only adds fields, preferences, policies and indexes; existing rows stay intact.

alter table public.items
  add column if not exists is_starred boolean not null default false;

alter table public.items
  add column if not exists planned_for date;

update public.items
set is_starred = false
where is_starred is null;

create index if not exists items_user_priority
  on public.items (user_id, planned_for, is_starred, created_at desc);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  quick_save_category_id uuid references public.categories(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "owner manages preferences" on public.user_preferences;
create policy "owner manages preferences"
  on public.user_preferences for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into public.user_preferences (user_id, quick_save_category_id, updated_at)
select
  owner.user_id,
  (
    select category.id
    from public.categories as category
    where category.user_id = owner.user_id
      and lower(category.name) = lower('其他')
    order by category.sort_order, category.created_at
    limit 1
  ),
  now()
from public.app_owner as owner
on conflict (user_id) do nothing;

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

  insert into public.user_preferences (user_id, quick_save_category_id)
  select new.id, id
  from public.categories
  where user_id = new.id and lower(name) = lower('其他')
  limit 1;

  return new;
exception
  when unique_violation then
    raise exception 'Do It Laaaaaater 已经有唯一账号';
end;
$$;
