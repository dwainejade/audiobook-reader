alter table chapters add column if not exists spans jsonb not null default '[]';
