# Database

Supabase Postgres is the primary data store. All tables use Row Level Security (RLS) so users can only access their own data.

---

## Schema

### `books`
Stores uploaded book metadata.

```sql
CREATE TABLE books (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  author          TEXT,
  cover_url       TEXT,
  epub_url        TEXT NOT NULL,         -- Supabase Storage path
  total_chapters  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing', 'ready', 'error')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `chapters`
One row per chapter. Text content stored here for re-processing without re-parsing the EPUB.

```sql
CREATE TABLE chapters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id          UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  index            INTEGER NOT NULL,     -- 0-based chapter order
  title            TEXT,
  text_content     TEXT NOT NULL,
  audio_url        TEXT,                 -- Supabase Storage path, null until done
  duration_seconds REAL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  UNIQUE (book_id, index)
);
```

### `jobs`
Tracks Bull queue job state mirrored in Postgres for querying without hitting Redis.

```sql
CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id   UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  bull_job_id  TEXT,                     -- Bull job ID for direct queue lookups
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (chapter_id)
);
```

### `playback_progress`
Saves the user's last position per book.

```sql
CREATE TABLE playback_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id          UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id       UUID NOT NULL REFERENCES chapters(id),
  position_seconds REAL NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id)
);
```

---

## Indexes

```sql
CREATE INDEX ON chapters (book_id, index);
CREATE INDEX ON jobs (book_id, status);
CREATE INDEX ON playback_progress (user_id, book_id);
```

---

## Row Level Security

```sql
-- Enable RLS on all tables
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE playback_progress ENABLE ROW LEVEL SECURITY;

-- books: users own their own rows
CREATE POLICY "users_own_books" ON books
  USING (user_id = auth.uid());

-- chapters: accessible if user owns parent book
CREATE POLICY "users_own_chapters" ON chapters
  USING (book_id IN (SELECT id FROM books WHERE user_id = auth.uid()));

-- jobs: same as chapters
CREATE POLICY "users_own_jobs" ON jobs
  USING (book_id IN (SELECT id FROM books WHERE user_id = auth.uid()));

-- playback_progress: users own their own rows
CREATE POLICY "users_own_progress" ON playback_progress
  USING (user_id = auth.uid());
```

The TTS worker uses the Supabase **service role key** (bypasses RLS) to write audio URLs and update job status.

---

## Supabase Storage Buckets

| Bucket | Path Pattern | Access |
|---|---|---|
| `epubs` | `epubs/{userId}/{bookId}.epub` | Private (API only) |
| `audio` | `audio/{bookId}/{chapterId}.mp3` | Private (signed URLs, 24h TTL) |
| `covers` | `covers/{bookId}.jpg` | Public |

---

## Realtime

The mobile app subscribes to chapter status changes to unlock audio as it's generated:

```js
supabase
  .channel('chapters')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'chapters',
    filter: `book_id=eq.${bookId}`,
  }, (payload) => {
    // payload.new.status === 'done' → unlock chapter in player
  })
  .subscribe()
```
