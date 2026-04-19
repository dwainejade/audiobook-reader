# API Reference

Base URL: `http://localhost:3001/api`

All endpoints require a Supabase JWT in the `Authorization` header:
```
Authorization: Bearer <supabase_access_token>
```

---

## Books

### Upload EPUB
`POST /api/books/upload`

Multipart form upload. Parses the EPUB, creates DB records, enqueues TTS jobs for all chapters.

**Request**
```
Content-Type: multipart/form-data
Body: epub (file)
```

**Response `201`**
```json
{
  "id": "uuid",
  "title": "Moby Dick",
  "author": "Herman Melville",
  "cover_url": "https://...",
  "total_chapters": 135,
  "status": "processing",
  "created_at": "2026-04-19T00:00:00Z"
}
```

**Errors**
| Code | Reason |
|---|---|
| `400` | No file uploaded or invalid EPUB |
| `413` | File exceeds 50MB limit |

---

### List Books
`GET /api/books`

Returns all books for the authenticated user.

**Response `200`**
```json
[
  {
    "id": "uuid",
    "title": "Moby Dick",
    "author": "Herman Melville",
    "cover_url": "https://...",
    "total_chapters": 135,
    "completed_chapters": 12,
    "status": "processing",
    "created_at": "2026-04-19T00:00:00Z"
  }
]
```

---

### Get Book Detail
`GET /api/books/:id`

Returns book metadata and all chapters with their audio URLs (signed, 24h TTL).

**Response `200`**
```json
{
  "id": "uuid",
  "title": "Moby Dick",
  "author": "Herman Melville",
  "chapters": [
    {
      "id": "uuid",
      "index": 0,
      "title": "Chapter 1 — Loomings",
      "duration_seconds": 312,
      "audio_url": "https://supabase.../signed-url",
      "status": "done"
    },
    {
      "id": "uuid",
      "index": 1,
      "title": "Chapter 2 — The Carpet-Bag",
      "duration_seconds": null,
      "audio_url": null,
      "status": "pending"
    }
  ]
}
```

**Errors**
| Code | Reason |
|---|---|
| `404` | Book not found or not owned by user |

---

### Delete Book
`DELETE /api/books/:id`

Deletes book, all chapters, all audio files from storage, and cancels pending jobs.

**Response `204`** — No content

---

## Jobs

### Get Job Status for Book
`GET /api/books/:id/jobs`

Returns per-chapter job status. Used by the mobile app to show generation progress.

**Response `200`**
```json
{
  "book_id": "uuid",
  "total": 135,
  "pending": 120,
  "processing": 3,
  "done": 12,
  "failed": 0,
  "jobs": [
    {
      "chapter_id": "uuid",
      "chapter_index": 0,
      "status": "done",
      "completed_at": "2026-04-19T00:01:23Z",
      "error": null
    }
  ]
}
```

### Retry Failed Chapter
`POST /api/books/:bookId/chapters/:chapterId/retry`

Re-enqueues a failed TTS job for a single chapter.

**Response `202`**
```json
{ "job_id": "uuid", "status": "pending" }
```

---

## Progress

### Save Playback Position
`PATCH /api/progress/:bookId`

**Request**
```json
{
  "chapter_id": "uuid",
  "position_seconds": 142.5
}
```

**Response `200`**
```json
{
  "book_id": "uuid",
  "chapter_id": "uuid",
  "position_seconds": 142.5,
  "updated_at": "2026-04-19T00:00:00Z"
}
```

### Get Playback Position
`GET /api/progress/:bookId`

Returns the last saved position to resume playback.

**Response `200`**
```json
{
  "book_id": "uuid",
  "chapter_id": "uuid",
  "position_seconds": 142.5,
  "updated_at": "2026-04-19T00:00:00Z"
}
```

**Response `404`** — No progress saved yet (start from beginning)

---

## Error Format

All errors return:
```json
{
  "error": "Human readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common codes: `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_EPUB`, `FILE_TOO_LARGE`, `JOB_ENQUEUE_FAILED`
