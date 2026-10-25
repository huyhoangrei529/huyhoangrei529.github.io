-- Run once in Supabase SQL Editor. Then enable Email and Google providers in
-- Authentication > Providers and add the deployed site to URL Configuration.
create table if not exists public.grading_records (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id text not null default '',
  exam_code text not null default '',
  correct_text text not null default '',
  correct_count integer,
  question_count integer not null default 0 check (question_count between 0 and 60),
  max_score numeric,
  score numeric,
  needs_check boolean not null default false,
  check_questions integer[] not null default '{}',
  recognized_answers text[] not null default '{}',
  correct_answers text[] not null default '{}',
  question_status text[] not null default '{}',
  incorrect_questions integer[] not null default '{}',
  unanswered_questions integer[] not null default '{}',
  review_details text[] not null default '{}',
  processing_error text not null default '',
  exam_config jsonb not null default '{}'::jsonb,
  image_path text,
  sync_status text not null default 'synced' check (sync_status in ('pending','synced')),
  created_at timestamptz not null default now()
);
create index if not exists grading_records_owner_created_idx
  on public.grading_records (owner_id, created_at desc);
alter table public.grading_records enable row level security;
drop policy if exists "Users read own grading records" on public.grading_records;
create policy "Users read own grading records" on public.grading_records
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Users insert own grading records" on public.grading_records;
create policy "Users insert own grading records" on public.grading_records
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Users update own grading records" on public.grading_records;
create policy "Users update own grading records" on public.grading_records
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
drop policy if exists "Users delete own grading records" on public.grading_records;
create policy "Users delete own grading records" on public.grading_records
  for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.grading_records to authenticated;

create table if not exists public.user_exam_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_exam_configs enable row level security;
drop policy if exists "Users manage own exam configuration" on public.user_exam_configs;
create policy "Users manage own exam configuration" on public.user_exam_configs
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.user_exam_configs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('grading-sheets', 'grading-sheets', false, 12582912, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 12582912,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "Users read own grading images" on storage.objects;
create policy "Users read own grading images" on storage.objects
  for select to authenticated using (bucket_id = 'grading-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users upload own grading images" on storage.objects;
create policy "Users upload own grading images" on storage.objects
  for insert to authenticated with check (bucket_id = 'grading-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users update own grading images" on storage.objects;
create policy "Users update own grading images" on storage.objects
  for update to authenticated using (bucket_id = 'grading-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'grading-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete own grading images" on storage.objects;
create policy "Users delete own grading images" on storage.objects
  for delete to authenticated using (bucket_id = 'grading-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
