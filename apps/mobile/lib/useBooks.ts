import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Book = {
  id: string;
  title: string;
  author: string;
  cover_url: string | null;
  total_chapters: number;
  done_chapters: number;
  progress: number;
  current_chapter: string | null;
  status: 'pending' | 'processing' | 'done';
};

export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: ReturnType<typeof supabase.channel>;

    async function fetchBooks() {
      const { data, error } = await supabase
        .from('books')
        .select('id,title,author,cover_url,total_chapters,done_chapters,progress,current_chapter,status')
        .order('created_at', { ascending: false });

      if (error) {
        setError(error.message);
      } else {
        setBooks(data ?? []);
      }
      setLoading(false);
    }

    fetchBooks();

    // Real-time updates
    subscription = supabase
      .channel('books-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, () => {
        fetchBooks();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  return { books, loading, error };
}
