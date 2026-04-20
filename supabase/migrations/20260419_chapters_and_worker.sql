-- Chapters table
create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id) on delete cascade not null,
  index int not null,
  title text not null,
  text text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  audio_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chapters_book_id_idx on chapters(book_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists chapters_updated_at on chapters;
create trigger chapters_updated_at
  before update on chapters
  for each row execute function update_updated_at();

-- RLS: service role bypasses RLS, so no policy needed for worker writes.
-- Users read chapters for their own books via join check.
alter table chapters enable row level security;

drop policy if exists "users can read own chapters" on chapters;
create policy "users can read own chapters"
  on chapters for select using (
    exists (select 1 from books where books.id = chapters.book_id and books.user_id = auth.uid())
  );

-- Atomic increment of done_chapters + update progress + flip book status when complete
create or replace function increment_done_chapters(book_id_arg uuid)
returns void language plpgsql security definer as $$
declare
  v_done int;
  v_total int;
begin
  update books
  set done_chapters = done_chapters + 1
  where id = book_id_arg
  returning done_chapters, total_chapters into v_done, v_total;

  if v_total > 0 then
    update books
    set
      progress = v_done::float / v_total::float,
      status = case when v_done >= v_total then 'done' else 'processing' end
    where id = book_id_arg;
  end if;
end $$;

-- Storage bucket for audio (idempotent via DO block)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('audio', 'audio', false)
  on conflict (id) do nothing;
end $$;

-- Storage policy: service role can upload; users can read their own audio via signed URLs
drop policy if exists "service role audio upload" on storage.objects;
create policy "service role audio upload"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'audio');

drop policy if exists "service role audio update" on storage.objects;
create policy "service role audio update"
  on storage.objects for update
  to service_role
  using (bucket_id = 'audio');
