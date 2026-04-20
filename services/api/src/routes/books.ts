import { Router } from 'express';
import multer from 'multer';
import { EPub } from 'epub2';
import { supabase } from '../lib/supabase';
import { ttsQueue } from '../lib/queue';
import { requireAuth } from '../lib/auth';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? '50')) * 1024 * 1024 },
});

// GET /api/books
router.get('/', requireAuth, async (req, res) => {
  const user = res.locals.user;
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/books/:id
router.get('/:id', requireAuth, async (req, res) => {
  const user = res.locals.user;
  const { data: book, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', user.id)
    .single();

  if (error || !book) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

  const { data: chapters } = await supabase
    .from('chapters')
    .select('*')
    .eq('book_id', book.id)
    .order('index', { ascending: true });

  // Generate signed URLs for done chapters
  const chaptersWithUrls = await Promise.all(
    (chapters ?? []).map(async (ch: any) => {
      if (ch.audio_path) {
        const { data: signed } = await supabase.storage
          .from('audio')
          .createSignedUrl(ch.audio_path, 60 * 60 * 24);
        return { ...ch, audio_url: signed?.signedUrl ?? null };
      }
      return { ...ch, audio_url: null };
    })
  );

  res.json({ ...book, chapters: chaptersWithUrls });
});

// POST /api/books/upload
router.post('/upload', requireAuth, upload.single('epub'), async (req, res) => {
  const user = res.locals.user;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
  if (!req.file.originalname.endsWith('.epub')) {
    return res.status(400).json({ error: 'Invalid EPUB', code: 'INVALID_EPUB' });
  }

  let epub: any;
  try {
    epub = await EPub.createAsync(req.file.buffer as any);
    await epub.parse();
  } catch {
    return res.status(400).json({ error: 'Failed to parse EPUB', code: 'INVALID_EPUB' });
  }

  const metadata = epub.metadata;
  const title = metadata.title ?? 'Untitled';
  const author = metadata.creator ?? 'Unknown';

  // Insert book record
  const { data: book, error: bookError } = await supabase
    .from('books')
    .insert({
      user_id: user.id,
      title,
      author,
      status: 'processing',
    })
    .select()
    .single();

  if (bookError || !book) {
    return res.status(500).json({ error: 'Failed to create book', code: 'DB_ERROR' });
  }

  // Upload epub to storage
  const epubPath = `${user.id}/${book.id}.epub`;
  await supabase.storage.from('epubs').upload(epubPath, req.file.buffer, {
    contentType: 'application/epub+zip',
  });

  // Extract chapters
  const flow = epub.flow as { id: string; href: string }[];
  const chapterTexts: { index: number; title: string; text: string }[] = [];

  for (let i = 0; i < flow.length; i++) {
    try {
      const text = await new Promise<string>((resolve, reject) => {
        epub.getChapter(flow[i].id, (err: any, data: string) => {
          if (err) reject(err);
          else resolve(data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        });
      });
      if (text.length > 50) {
        chapterTexts.push({ index: i, title: `Chapter ${i + 1}`, text });
      }
    } catch {
      // skip unparseable chapters
    }
  }

  if (chapterTexts.length === 0) {
    return res.status(400).json({ error: 'No chapters found', code: 'INVALID_EPUB' });
  }

  // Insert chapters
  const { data: chapters, error: chapError } = await supabase
    .from('chapters')
    .insert(
      chapterTexts.map((ch) => ({
        book_id: book.id,
        index: ch.index,
        title: ch.title,
        text: ch.text,
        status: 'pending',
      }))
    )
    .select();

  if (chapError) {
    return res.status(500).json({ error: 'Failed to create chapters', code: 'DB_ERROR' });
  }

  // Update book chapter count
  await supabase
    .from('books')
    .update({ total_chapters: chapterTexts.length })
    .eq('id', book.id);

  // Enqueue TTS jobs
  for (const ch of chapters ?? []) {
    await ttsQueue.add('tts', {
      chapterId: ch.id,
      bookId: book.id,
      text: ch.text,
    });
  }

  res.status(201).json({ ...book, total_chapters: chapterTexts.length });
});

// DELETE /api/books/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const user = res.locals.user;

  const { data: book } = await supabase
    .from('books')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', user.id)
    .single();

  if (!book) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

  // Delete audio files from storage
  const { data: chapters } = await supabase
    .from('chapters')
    .select('audio_path')
    .eq('book_id', book.id)
    .not('audio_path', 'is', null);

  if (chapters?.length) {
    await supabase.storage
      .from('audio')
      .remove(chapters.map((c: any) => c.audio_path));
  }

  // Delete epub
  await supabase.storage.from('epubs').remove([`${user.id}/${book.id}.epub`]);

  // Cascade deletes chapters via DB foreign key
  await supabase.from('books').delete().eq('id', book.id);

  res.status(204).send();
});

// GET /api/books/:id/jobs
router.get('/:id/jobs', requireAuth, async (req, res) => {
  const user = res.locals.user;

  const { data: book } = await supabase
    .from('books')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', user.id)
    .single();

  if (!book) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, index, status, updated_at')
    .eq('book_id', book.id)
    .order('index');

  const jobs = (chapters ?? []).map((ch: any) => ({
    chapter_id: ch.id,
    chapter_index: ch.index,
    status: ch.status,
    completed_at: ch.status === 'done' ? ch.updated_at : null,
    error: null,
  }));

  const counts = jobs.reduce(
    (acc: any, j: any) => { acc[j.status] = (acc[j.status] ?? 0) + 1; return acc; },
    {}
  );

  res.json({
    book_id: book.id,
    total: jobs.length,
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    done: counts.done ?? 0,
    failed: counts.failed ?? 0,
    jobs,
  });
});

// POST /api/books/:bookId/chapters/:chapterId/retry
router.post('/:bookId/chapters/:chapterId/retry', requireAuth, async (req, res) => {
  const user = res.locals.user;

  const { data: book } = await supabase
    .from('books')
    .select('id')
    .eq('id', req.params.bookId)
    .eq('user_id', user.id)
    .single();

  if (!book) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

  const { data: chapter } = await supabase
    .from('chapters')
    .select('*')
    .eq('id', req.params.chapterId)
    .eq('book_id', book.id)
    .single();

  if (!chapter) return res.status(404).json({ error: 'Chapter not found', code: 'NOT_FOUND' });

  await supabase.from('chapters').update({ status: 'pending' }).eq('id', chapter.id);

  const job = await ttsQueue.add('tts', {
    chapterId: chapter.id,
    bookId: book.id,
    text: chapter.text,
  });

  res.status(202).json({ job_id: job.id, status: 'pending' });
});

export default router;
