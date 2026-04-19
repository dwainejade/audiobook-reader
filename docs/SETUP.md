# Setup Guide

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | `brew install node` |
| Python | 3.10+ | `brew install python` |
| Redis | 7+ | `brew install redis` |
| ffmpeg | any | `brew install ffmpeg` |
| Docker | optional | docker.com |

---

## Project Structure

```
audiobookreader/
├── apps/
│   └── mobile/              # Expo app
├── services/
│   ├── api/                 # Node.js + Express
│   └── tts-worker/          # Python + Kokoro
├── docs/
├── supabase/
│   └── migrations/
└── docker-compose.yml
```

---

## 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run migrations:
   ```bash
   cd supabase
   npx supabase db push
   ```
3. Create storage buckets in the Supabase dashboard:
   - `epubs` (private)
   - `audio` (private)
   - `covers` (public)
4. Enable Realtime on the `chapters` table in the Supabase dashboard

---

## 2. Environment Variables

### `services/api/.env`
```env
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
REDIS_URL=redis://localhost:6379
MAX_UPLOAD_SIZE_MB=50
```

### `services/tts-worker/.env`
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
REDIS_URL=redis://localhost:6379
KOKORO_DEVICE=cpu          # or 'cuda' or 'mps'
DEFAULT_VOICE=af_heart
AUDIO_BITRATE=128k
```

### `apps/mobile/.env`
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_API_URL=http://localhost:3001
```

---

## 3. API Server

```bash
cd services/api
npm install
npm run dev     # starts on port 3001 with nodemon
```

---

## 4. TTS Worker

```bash
cd services/tts-worker

# Create virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Download Kokoro model (first run, ~330MB)
python -c "from kokoro import KPipeline; KPipeline(lang_code='a')"

# Start worker
python worker.py
```

---

## 5. Redis

```bash
# Start Redis locally
redis-server

# Verify
redis-cli ping   # → PONG
```

---

## 6. Mobile App

```bash
cd apps/mobile
npm install
npm start        # Expo dev server

# Run on device/simulator
npm run ios
npm run android
```

---

## Docker (Alternative)

Run everything except the mobile app with Docker Compose:

```bash
docker-compose up
```

```yaml
# docker-compose.yml (overview)
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: ./services/api
    ports: ["3001:3001"]
    env_file: ./services/api/.env
    depends_on: [redis]

  tts-worker:
    build: ./services/tts-worker
    env_file: ./services/tts-worker/.env
    depends_on: [redis]
    volumes:
      - kokoro-models:/root/.cache/kokoro   # persist downloaded model weights

volumes:
  kokoro-models:
```

---

## Run Order (Local Dev)

1. `redis-server`
2. `cd services/api && npm run dev`
3. `cd services/tts-worker && python worker.py`
4. `cd apps/mobile && npm start`

---

## Verify Everything Works

1. Open the Expo app → Auth screen appears
2. Sign up with email
3. Tap `+` → pick any `.epub` file
4. Upload completes → book appears in library with "processing" state
5. Check Redis: `redis-cli llen bull:tts-jobs:wait` → shows queued jobs
6. Worker logs show chapters being processed
7. Supabase Storage → `audio/` bucket fills with MP3s
8. Mobile app updates in real-time as chapters unlock
9. Tap a completed chapter → audio plays
10. Background the app → reopen → resumes from last position
