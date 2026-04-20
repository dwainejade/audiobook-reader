alter table books add column if not exists toc jsonb not null default '[]';
