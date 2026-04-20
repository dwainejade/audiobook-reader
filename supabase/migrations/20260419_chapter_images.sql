alter table chapters add column if not exists images jsonb not null default '[]';

-- Storage bucket for covers
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('covers', 'covers', true)
  on conflict (id) do nothing;
end $$;

drop policy if exists "service role covers upload" on storage.objects;
create policy "service role covers upload"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'covers');

drop policy if exists "public covers read" on storage.objects;
create policy "public covers read"
  on storage.objects for select
  using (bucket_id = 'covers');
