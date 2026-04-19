# TTS Service

The TTS worker is a Python process that consumes Bull jobs from Redis, runs Kokoro inference, and uploads the resulting MP3 to Supabase Storage.

---

## Kokoro Overview

[Kokoro](https://github.com/remsky/Kokoro-FastAPI) is a state-of-the-art open-source TTS model. Key properties:

- Model size: ~82M parameters (fast inference)
- Quality: Comparable to commercial APIs
- Voices: Multiple English voices (af_heart, af_bella, am_adam, bf_emma, etc.)
- Output: 24kHz WAV → converted to 128kbps MP3
- Runtime: CPU works; GPU (CUDA/MPS) is 5–10× faster

---

## Worker Architecture

```
Redis (Bull queue: "tts-jobs")
        │
        ▼
worker.py  ─── polls for jobs ──→ kokoro_tts.py
                                        │
                                        ▼
                                  Kokoro model inference
                                        │
                                        ▼
                                  WAV → MP3 (ffmpeg)
                                        │
                                        ▼
                                  Supabase Storage upload
                                        │
                                        ▼
                                  Update chapters + jobs in Postgres
```

The worker uses [bullmq-python](https://github.com/taskiq-python/taskiq-redis) or a lightweight Redis client to poll the `tts-jobs` queue directly. No heavy framework needed.

---

## Job Schema

Jobs are enqueued by the Express API with this payload:

```json
{
  "chapterId": "uuid",
  "bookId": "uuid",
  "text": "Full chapter text content...",
  "voice": "af_heart",
  "speed": 1.0
}
```

Job queue name: `tts-jobs`
Retry policy: 3 attempts, exponential backoff (30s, 2m, 10m)

---

## File: `worker.py`

```python
# Pseudocode — actual implementation will follow
import redis
import json
from kokoro_tts import synthesize
from supabase_upload import upload_audio
from db import update_chapter_status

r = redis.Redis(host='localhost', port=6379)

while True:
    _, raw = r.blpop('bull:tts-jobs:wait')
    job = json.loads(raw)

    update_chapter_status(job['chapterId'], 'processing')

    try:
        mp3_path = synthesize(
            text=job['text'],
            voice=job['voice'],
            speed=job['speed'],
            output_path=f"/tmp/{job['chapterId']}.mp3"
        )
        audio_url = upload_audio(mp3_path, job['bookId'], job['chapterId'])
        update_chapter_status(job['chapterId'], 'done', audio_url=audio_url)
    except Exception as e:
        update_chapter_status(job['chapterId'], 'failed', error=str(e))
```

---

## File: `kokoro_tts.py`

```python
from kokoro import KPipeline
import soundfile as sf
import subprocess

pipeline = KPipeline(lang_code='a')  # 'a' = American English

def synthesize(text: str, voice: str, speed: float, output_path: str) -> str:
    wav_path = output_path.replace('.mp3', '.wav')
    
    generator = pipeline(text, voice=voice, speed=speed)
    samples = []
    for _, _, audio in generator:
        samples.append(audio)
    
    import numpy as np
    audio_data = np.concatenate(samples)
    sf.write(wav_path, audio_data, 24000)
    
    # Convert to MP3
    subprocess.run([
        'ffmpeg', '-y', '-i', wav_path,
        '-codec:a', 'libmp3lame', '-b:a', '128k',
        output_path
    ], check=True)
    
    return output_path
```

---

## Audio Output Spec

| Property | Value |
|---|---|
| Format | MP3 |
| Bitrate | 128kbps |
| Sample rate | 24kHz (Kokoro native) |
| Channels | Mono |
| Naming | `audio/{bookId}/{chapterId}.mp3` |

---

## Available Voices

| Voice ID | Style |
|---|---|
| `af_heart` | Warm female (default) |
| `af_bella` | Expressive female |
| `af_sarah` | Neutral female |
| `am_adam` | Neutral male |
| `am_michael` | Deep male |
| `bf_emma` | British female |
| `bm_george` | British male |

Users can select their preferred voice in the mobile app Settings screen. The choice is stored per-user and passed in the job payload.

---

## Performance Notes

- CPU: ~0.5–1× realtime (a 10min chapter takes 5–10min to generate)
- Apple Silicon (MPS): ~3–5× realtime
- NVIDIA GPU (CUDA): ~5–10× realtime
- Text is chunked at sentence boundaries for long chapters to avoid memory issues (>5000 chars per chunk)
- Chunks are concatenated before MP3 conversion

---

## Dependencies (`requirements.txt`)

```
kokoro>=0.9.2
soundfile>=0.12.1
numpy>=1.24.0
redis>=5.0.0
supabase>=2.0.0
ffmpeg-python>=0.2.0
```

System dependency: `ffmpeg` must be installed (`brew install ffmpeg` / `apt install ffmpeg`)
