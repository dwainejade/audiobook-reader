import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import booksRouter from './routes/books';
import progressRouter from './routes/progress';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.use('/api/books', booksRouter);
app.use('/api/progress', progressRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
