import { Request, Response, NextFunction } from 'express';
import { supabase } from './supabase';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  res.locals.user = data.user;
  next();
}
