"""
TTS worker — consumes BullMQ jobs from Redis, generates audio with Kokoro,
uploads to Supabase storage, updates chapter status.
"""

import io
import json
import os
import re
import time
import warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import redis
import soundfile as sf
import torch
from pydub import AudioSegment
from dotenv import load_dotenv
from kokoro import KPipeline
from loguru import logger
from supabase import create_client

load_dotenv()

warnings.filterwarnings("ignore", message=".*resized since it had shape.*")
warnings.filterwarnings("ignore", message=".*dropout option adds dropout.*")
warnings.filterwarnings("ignore", message=".*weight_norm` is deprecated.*")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
QUEUE_NAME = "tts-jobs"
VOICE = os.environ.get("TTS_VOICE", "af_heart")
SAMPLE_RATE = 24000

r = redis.from_url(REDIS_URL, decode_responses=True)
db = create_client(SUPABASE_URL, SUPABASE_KEY)

device = "mps" if torch.backends.mps.is_available() else "cpu"
logger.info(f"Loading Kokoro pipeline on {device}…")
pipeline = KPipeline(lang_code="a", device=device)
logger.info("Kokoro ready. Waiting for jobs…")

deleted_books: set[str] = set()
upload_executor = ThreadPoolExecutor(max_workers=2)


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


MAX_CHUNK_CHARS = 1000

def synthesize(text: str, job_id: str) -> tuple[bytes, list[dict]]:
    """Returns (mp3_bytes, timestamps) where timestamps = [{charStart, timeSec}]."""
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    chunks_text: list[str] = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 > MAX_CHUNK_CHARS and current:
            chunks_text.append(current)
            current = sentence
        else:
            current = (current + " " + sentence).strip()
    if current:
        chunks_text.append(current)

    logger.info(f"Job {job_id} | synthesizing {len(chunks_text)} chunk(s)…")
    audio_chunks: list[np.ndarray] = []
    # timestamps: one entry per chunk — charStart in original text, timeSec = start of this chunk
    timestamps: list[dict] = []
    cumulative_samples = 0
    char_cursor = 0

    with torch.no_grad():
        for i, chunk in enumerate(chunks_text):
            t0 = time.monotonic()
            chunk_audio_parts: list[np.ndarray] = []
            for _, _, audio in pipeline(chunk, voice=VOICE):
                if audio is not None:
                    chunk_audio_parts.append(audio)
            logger.debug(f"Job {job_id} | chunk {i+1}/{len(chunks_text)} done ({time.monotonic()-t0:.1f}s)")

            if chunk_audio_parts:
                chunk_audio = np.concatenate(chunk_audio_parts)
                # Find where this chunk starts in the original text
                char_start = text.find(chunk, char_cursor)
                if char_start == -1:
                    char_start = char_cursor
                timestamps.append({
                    "charStart": char_start,
                    "timeSec": cumulative_samples / SAMPLE_RATE,
                })
                cumulative_samples += len(chunk_audio)
                char_cursor = char_start + len(chunk)
                audio_chunks.append(chunk_audio)

    if not audio_chunks:
        raise ValueError("Kokoro returned no audio")
    combined = np.concatenate(audio_chunks)

    logger.info(f"Job {job_id} | encoding mp3…")
    wav_buf = io.BytesIO()
    sf.write(wav_buf, combined, SAMPLE_RATE, format="WAV")
    wav_buf.seek(0)

    segment = AudioSegment.from_wav(wav_buf)
    mp3_buf = io.BytesIO()
    segment.export(mp3_buf, format="mp3", bitrate="64k")
    return mp3_buf.getvalue(), timestamps


def upload_and_finalize(audio_bytes: bytes, audio_path: str, chapter_id: str, book_id: str, timestamps: list[dict]) -> None:
    logger.info(f"Uploading {len(audio_bytes)//1024}KB → {audio_path}")
    db.storage.from_("audio").upload(
        audio_path,
        audio_bytes,
        {"content-type": "audio/mpeg", "upsert": "true"},
    )
    db.table("chapters").update({
        "status": "done",
        "audio_path": audio_path,
        "timestamps": timestamps,
    }).eq("id", chapter_id).execute()
    db.rpc("increment_done_chapters", {"book_id_arg": book_id}).execute()


def process(job_id: str, data: dict) -> None:
    chapter_id = data["chapterId"]
    book_id = data["bookId"]
    text = data["text"]

    logger.info(f"Job {job_id} | chapter {chapter_id[:8]}… | {len(text)} chars")

    # Bail early if book was deleted
    if book_id in deleted_books:
        logger.warning(f"Job {job_id} skipped — book {book_id[:8]}… deleted")
        return
    exists = db.table("books").select("id").eq("id", book_id).limit(1).execute()
    if not exists.data:
        deleted_books.add(book_id)
        logger.warning(f"Job {job_id} skipped — book {book_id[:8]}… deleted")
        return

    sentence_count = len(re.findall(r'[.!?]\s', text))
    if len(text) < 500 or sentence_count < 3:
        logger.info(f"Job {job_id} skipped (junk chapter)")
        db.table("chapters").update({"status": "failed"}).eq("id", chapter_id).execute()
        return

    db.table("chapters").update({"status": "processing"}).eq("id", chapter_id).execute()

    audio_bytes, timestamps = synthesize(text, job_id)

    audio_path = f"{book_id}/{chapter_id}.mp3"
    # Upload and DB finalization run in a thread so synthesis of the next job
    # can start immediately without waiting for the network round-trips.
    future = upload_executor.submit(upload_and_finalize, audio_bytes, audio_path, chapter_id, book_id, timestamps)
    future.result()  # still wait so errors surface; next job's synthesis overlaps with *this* upload

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
            try:
                db.table("chapters").update({"status": "failed"}).eq("id", data.get("chapterId", "")).execute()
            except Exception:
                pass


if __name__ == "__main__":
    main()
