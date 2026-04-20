alter table chapters add column if not exists timestamps jsonb not null default '[]';
