# Architecture

## Overview

AudioBookReader converts EPUB files into audiobooks using a local Kokoro TTS engine. The system is split into three services: a mobile Expo app, a Node.js/Express API, and a Python TTS worker — all coordinated via a Bull/Redis job queue and Supabase as the data/storage layer.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Expo Mobile App                       │
│  Upload EPUB → View Library → Player UI → Progress Sync │
└────────────────────┬────────────────────────────────────┘
                     │ REST + Supabase Realtime
┌────────────────────▼────────────────────────────────────┐
│                 Express API Server                       │
│  /upload  /books  /jobs  /progress                       │
│  epub parsing → chapter extraction → Bull job producer  │
└────────┬───────────────────────┬────────────────────────┘
         │                       │
┌────────▼───────┐    ┌──────────▼──────────┐
│  Bull Queue    │    │   Supabase           │
│  (Redis)       │    │   Postgres + Storage │
└────────┬───────┘    └─────────────────────┘
         │
┌────────▼───────────────────────────────────────────────┐
│              Kokoro TTS Worker (Python)                  │
│  consume job → generate mp3 → upload to Supabase        │
│  → update DB → Realtime notification to mobile          │
└────────────────────────────────────────────────────────┘
```

## Data Flow

### Upload Flow
1. User picks an EPUB in the mobile app
2. App uploads file to Express API (`POST /api/books/upload`)
3. API stores the EPUB in Supabase Storage (`epubs/{userId}/{bookId}.epub`)
4. API uses the `epub` npm package to extract metadata and chapter text
5. Book and chapter records created in Postgres (`status: pending`)
6. One Bull job enqueued per chapter: `{ chapterId, bookId, text }`
7. API returns book record with job IDs — mobile app starts polling via Realtime

### TTS Generation Flow
1. Kokoro Python worker picks up a Bull job
2. Runs Kokoro inference on chapter text → produces WAV
3. Converts to MP3 (128kbps) via ffmpeg
4. Uploads MP3 to Supabase Storage (`audio/{bookId}/{chapterId}.mp3`)
5. Updates `chapters.audio_url`, `chapters.status = done`
6. Marks Bull job complete
7. Supabase Postgres change triggers Realtime event to subscribed mobile clients

### Playback Flow
1. Mobile app loads book — chapters with `status: done` are playable
2. Audio URL fetched from Supabase Storage (signed URL, 24h TTL)
3. `expo-audio` streams the MP3
4. On pause/chapter change, app calls `PATCH /api/progress/:bookId`
5. On app launch, `GET /api/progress/:bookId` resumes from saved position

## Service Boundaries

| Service | Responsibility | Communicates With |
|---|---|---|
| Expo Mobile | UI, playback, upload | API (REST), Supabase (Realtime, Auth) |
| Express API | EPUB parsing, job production, progress | Supabase (DB + Storage), Redis |
| Kokoro Worker | TTS inference, audio upload | Redis (Bull), Supabase (DB + Storage) |

## Tech Stack Rationale

- **Kokoro TTS**: State-of-the-art open-source model, no API costs, runs locally
- **Bull + Redis**: Reliable job queue with retries, concurrency control, and visibility
- **Supabase**: Postgres + Storage + Auth + Realtime in one managed platform — eliminates need for separate WebSocket server
- **Node.js + Express**: Shared JS ecosystem with the mobile app; good epub library support
- **Expo**: Cross-platform iOS/Android/Web from a single codebase
