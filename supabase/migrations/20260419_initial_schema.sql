-- Books table
create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  author text not null,
  cover_url text,
  total_chapters int not null default 0,
  done_chapters int not null default 0,
  progress float not null default 0,
  current_chapter text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done')),
  created_at timestamptz not null default now()
);

-- Row-level security: users only see their own books
alter table books enable row level security;

create policy "users can read own books"
  on books for select using (auth.uid() = user_id);

create policy "users can insert own books"
  on books for insert with check (auth.uid() = user_id);

create policy "users can update own books"
  on books for update using (auth.uid() = user_id);

create policy "users can delete own books"
  on books for delete using (auth.uid() = user_id);
