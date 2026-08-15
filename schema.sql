-- CHAPTER MUSIC LIBRARY V2
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Then create two PUBLIC buckets named exactly: covers and music.
-- Authentication: create your admin user in Supabase Dashboard -> Authentication -> Users.

create extension if not exists "pgcrypto";

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text default '',
  cover_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  chapter_number integer not null,
  title text not null,
  style text default '',
  created_at timestamptz not null default now(),
  unique(story_id, chapter_number)
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  track_number integer not null default 1,
  title text not null,
  artist text default '',
  source_type text not null default 'external',
  source_url text,
  audio_path text,
  created_at timestamptz not null default now()
);

alter table public.stories enable row level security;
alter table public.chapters enable row level security;
alter table public.tracks enable row level security;

-- PUBLIC CAN READ
drop policy if exists "stories_public_read" on public.stories;
create policy "stories_public_read" on public.stories
for select using (true);

drop policy if exists "chapters_public_read" on public.chapters;
create policy "chapters_public_read" on public.chapters
for select using (true);

drop policy if exists "tracks_public_read" on public.tracks;
create policy "tracks_public_read" on public.tracks
for select using (true);

-- ONLY LOGGED-IN USERS CAN WRITE
drop policy if exists "stories_auth_insert" on public.stories;
create policy "stories_auth_insert" on public.stories
for insert to authenticated with check (true);

drop policy if exists "stories_auth_update" on public.stories;
create policy "stories_auth_update" on public.stories
for update to authenticated using (true) with check (true);

drop policy if exists "stories_auth_delete" on public.stories;
create policy "stories_auth_delete" on public.stories
for delete to authenticated using (true);

drop policy if exists "chapters_auth_insert" on public.chapters;
create policy "chapters_auth_insert" on public.chapters
for insert to authenticated with check (true);

drop policy if exists "chapters_auth_update" on public.chapters;
create policy "chapters_auth_update" on public.chapters
for update to authenticated using (true) with check (true);

drop policy if exists "chapters_auth_delete" on public.chapters;
create policy "chapters_auth_delete" on public.chapters
for delete to authenticated using (true);

drop policy if exists "tracks_auth_insert" on public.tracks;
create policy "tracks_auth_insert" on public.tracks
for insert to authenticated with check (true);

drop policy if exists "tracks_auth_update" on public.tracks;
create policy "tracks_auth_update" on public.tracks
for update to authenticated using (true) with check (true);

drop policy if exists "tracks_auth_delete" on public.tracks;
create policy "tracks_auth_delete" on public.tracks
for delete to authenticated using (true);

-- STORAGE POLICIES
-- Create PUBLIC buckets "covers" and "music" first in Storage UI.
-- Public read:
drop policy if exists "public_read_covers" on storage.objects;
create policy "public_read_covers" on storage.objects
for select using (bucket_id = 'covers');

drop policy if exists "public_read_music" on storage.objects;
create policy "public_read_music" on storage.objects
for select using (bucket_id = 'music');

-- Authenticated upload/update/delete:
drop policy if exists "auth_upload_covers" on storage.objects;
create policy "auth_upload_covers" on storage.objects
for insert to authenticated with check (bucket_id = 'covers');

drop policy if exists "auth_upload_music" on storage.objects;
create policy "auth_upload_music" on storage.objects
for insert to authenticated with check (bucket_id = 'music');

drop policy if exists "auth_update_covers" on storage.objects;
create policy "auth_update_covers" on storage.objects
for update to authenticated using (bucket_id = 'covers') with check (bucket_id = 'covers');

drop policy if exists "auth_update_music" on storage.objects;
create policy "auth_update_music" on storage.objects
for update to authenticated using (bucket_id = 'music') with check (bucket_id = 'music');

drop policy if exists "auth_delete_covers" on storage.objects;
create policy "auth_delete_covers" on storage.objects
for delete to authenticated using (bucket_id = 'covers');

drop policy if exists "auth_delete_music" on storage.objects;
create policy "auth_delete_music" on storage.objects
for delete to authenticated using (bucket_id = 'music');
