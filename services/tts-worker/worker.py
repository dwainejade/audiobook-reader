"""
TTS worker — consumes BullMQ jobs from Redis, generates audio with Kokoro,
uploads to Supabase storage, updates chapter status.
"""

import io
import json
import os
import time

import numpy as np
import redis
import soundfile as sf
from dotenv import load_dotenv
from kokoro import KPipeline
from loguru import logger
from supabase import create_client

load_dotenv()

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
QUEUE_NAME = "tts-jobs"
VOICE = os.environ.get("TTS_VOICE", "af_heart")
SAMPLE_RATE = 24000

r = redis.from_url(REDIS_URL, decode_responses=True)
db = create_client(SUPABASE_URL, SUPABASE_KEY)

logger.info("Loading Kokoro pipeline…")
pipeline = KPipeline(lang_code="a")
logger.info("Kokoro ready. Waiting for jobs…")


def claim_job() -> tuple[str, dict] | None:
    """Move one job id from wait → active, return (job_id, data) or None."""
    job_id = r.lmove(f"bull:{QUEUE_NAME}:wait", f"bull:{QUEUE_NAME}:active", "RIGHT", "LEFT")
    if not job_id:
        return None
    raw = r.hget(f"bull:{QUEUE_NAME}:{job_id}", "data")
    if not raw:
        return None
    return job_id, json.loads(raw)


def complete_job(job_id: str) -> None:
    r.lrem(f"bull:{QUEUE_NAME}:active", 0, job_id)


def fail_job(job_id: str) -> None:
    r.lmove(f"bull:{QUEUE_NAME}:active", f"bull:{QUEUE_NAME}:failed", "LEFT", "LEFT")


def synthesize(text: str) -> bytes:
    """Return WAV bytes for the given text."""
    chunks = []
    for _, _, audio in pipeline(text, voice=VOICE):
        if audio is not None:
            chunks.append(audio)
    if not chunks:
        raise ValueError("Kokoro returned no audio")
    combined = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, combined, SAMPLE_RATE, format="WAV")
    return buf.getvalue()


def process(job_id: str, data: dict) -> None:
    chapter_id = data["chapterId"]
    book_id = data["bookId"]
    text = data["text"]

    logger.info(f"Job {job_id} | chapter {chapter_id[:8]}… | {len(text)} chars")

    # Mark processing
    db.table("chapters").update({"status": "processing"}).eq("id", chapter_id).execute()

    audio_bytes = synthesize(text)

    # Upload to Supabase storage
    audio_path = f"{book_id}/{chapter_id}.wav"
    db.storage.from_("audio").upload(
        audio_path,
        audio_bytes,
        {"content-type": "audio/wav", "upsert": "true"},
    )

    # Update chapter as done
    db.table("chapters").update({
        "status": "done",
        "audio_path": audio_path,
    }).eq("id", chapter_id).execute()

    # Increment book done_chapters
    db.rpc("increment_done_chapters", {"book_id_arg": book_id}).execute()

    logger.success(f"Job {job_id} done — {audio_path}")


def main():
    while True:
        result = claim_job()
        if result is None:
            time.sleep(1)
            continue

        job_id, data = result
        try:
            process(job_id, data)
            complete_job(job_id)
        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            fail_job(job_id)
            # Mark chapter failed in DB
            try:
                db.table("chapters").update({"status": "failed"}).eq("id", data.get("chapterId", "")).execute()
            except Exception:
                pass


if __name__ == "__main__":
    main()
