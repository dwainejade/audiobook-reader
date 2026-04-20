import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth } from '../lib/auth';

const router = Router();

// GET /api/progress/:bookId
router.get('/:bookId', requireAuth, async (req, res) => {
  const user = res.locals.user;

  const { data, error } = await supabase
    .from('progress')
    .select('*')
    .eq('user_id', user.id)
    .eq('book_id', req.params.bookId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'No progress found', code: 'NOT_FOUND' });
  res.json(data);
});

// PATCH /api/progress/:bookId
router.patch('/:bookId', requireAuth, async (req, res) => {
  const user = res.locals.user;
  const { chapter_id, position_seconds } = req.body;

  if (!chapter_id || position_seconds === undefined) {
    return res.status(400).json({ error: 'Missing fields', code: 'BAD_REQUEST' });
  }

  const { data, error } = await supabase
    .from('progress')
    .upsert({
      user_id: user.id,
      book_id: req.params.bookId,
      chapter_id,
      position_seconds,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,book_id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
