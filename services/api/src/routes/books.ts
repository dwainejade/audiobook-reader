import { Router } from "express";
import multer from "multer";
import { EPub } from "epub2";
import he from "he";
import fs from "fs";
import os from "os";
import path from "path";
import { supabase } from "../lib/supabase";
import { ttsQueue } from "../lib/queue";
import { requireAuth } from "../lib/auth";

const router = Router();

// ── Rich-text span extraction ─────────────────────────────────────────────────

type FormatSpan = {
  charStart: number;
  charEnd: number;
  bold?: true;
  italic?: true;
  underline?: true;
};

const BOLD_TAGS = new Set(["b", "strong"]);
const ITALIC_TAGS = new Set(["i", "em", "cite"]);
const UNDERLINE_TAGS = new Set(["u", "ins"]);
const BLOCK_TAGS = new Set(["p", "div", "blockquote", "li", "tr", "td", "th"]);
// Tags whose inner text should be completely skipped
const SKIP_TAGS = new Set(["title", "style", "script", "meta", "link"]);

function getAttributeValue(tagString: string, name: string): string | null {
  const attrRe = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = attrRe.exec(tagString);
  return match ? match[2] : null;
}

function extractSpans(rawHtml: string): { text: string; spans: FormatSpan[] } {
  // Strip XML declaration, DOCTYPE, and head section entirely
  const html = rawHtml
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(style|script|title|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(meta|link)[^>]*\/?>/gi, "");

  const TOKEN_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>|([^<]+)/g;

  let buf = "";
  const stack: {
    tag: string;
    kind: "bold" | "italic" | "underline";
    openedAt: number;
  }[] = [];
  const rawSpans: FormatSpan[] = [];
  let skipDepth = 0; // >0 means we're inside a skip tag

  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(html)) !== null) {
    const [, closing, tagName, textNode] = m;
    const tag = tagName?.toLowerCase();

    if (textNode !== undefined) {
      if (skipDepth === 0) buf += he.decode(textNode.replace(/\s+/g, " "));
      continue;
    }

    if (closing) {
      if (SKIP_TAGS.has(tag)) {
        skipDepth = Math.max(0, skipDepth - 1);
        continue;
      }
      if (skipDepth > 0) continue;
      // Closing tag — emit a span for every matching open entry
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const entry = stack.splice(i, 1)[0];
          if (entry.openedAt < buf.length) {
            const span: FormatSpan = {
              charStart: entry.openedAt,
              charEnd: buf.length,
            };
            if (entry.kind === "bold") span.bold = true;
            if (entry.kind === "italic") span.italic = true;
            if (entry.kind === "underline") span.underline = true;
            rawSpans.push(span);
          }
          break;
        }
      }
      // Heading close → append closing marker then paragraph break
      if (/^h[1-6]$/.test(tag)) {
        buf += "##";
        if (!buf.endsWith("\n")) buf += "\n\n";
      } else if (BLOCK_TAGS.has(tag)) {
        if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n";
      }
    } else {
      if (SKIP_TAGS.has(tag)) {
        skipDepth++;
        continue;
      }
      if (skipDepth > 0) continue;
      // Opening tag
      if (/^h[1-6]$/.test(tag)) {
        if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n";
        buf += "##";
        stack.push({ tag, kind: "bold", openedAt: buf.length });
      } else if (BLOCK_TAGS.has(tag)) {
        if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n";
      } else if (tag === "br") {
        buf += "\n";
      } else if (tag === "img") {
        const altText =
          getAttributeValue(m[0], "alt") || getAttributeValue(m[0], "title");
        if (altText) {
          if (buf.length > 0 && !buf.endsWith(" ")) buf += " ";
          buf += `Image: ${he.decode(altText)} `;
        }
      } else if (BOLD_TAGS.has(tag)) {
        stack.push({ tag, kind: "bold", openedAt: buf.length });
      } else if (ITALIC_TAGS.has(tag)) {
        stack.push({ tag, kind: "italic", openedAt: buf.length });
      } else if (UNDERLINE_TAGS.has(tag)) {
        stack.push({ tag, kind: "underline", openedAt: buf.length });
      }
    }
  }

  // Normalise whitespace in the assembled text
  const text = buf
    .replace(/[ \t]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n /g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Merge adjacent/overlapping spans with the same flags, sort by start
  rawSpans.sort((a, b) => a.charStart - b.charStart);
  const spans: FormatSpan[] = [];
  for (const s of rawSpans) {
    const last = spans[spans.length - 1];
    if (
      last &&
      last.charEnd >= s.charStart &&
      last.bold === s.bold &&
      last.italic === s.italic &&
      last.underline === s.underline
    ) {
      last.charEnd = Math.max(last.charEnd, s.charEnd);
    } else {
      spans.push({ ...s });
    }
  }

  return { text, spans };
}

function sanitizeHtmlForStorage(rawHtml: string): string {
  return rawHtml
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<(script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(meta|link)[^>]*\/?>(\s*)/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
}

function rewriteImageSources(
  rawHtml: string,
  srcMap: Map<string, string>,
): string {
  if (srcMap.size === 0) return rawHtml;

  return rawHtml.replace(
    /<img([^>]*?)src=(['"])([^"']+)\2([^>]*)>/gi,
    (_, before, quote, src, after) => {
      const publicUrl = srcMap.get(src);
      if (!publicUrl) return _;
      return `<img${before}src=${quote}${publicUrl}${quote}${after}>`;
    },
  );
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? "50") * 1024 * 1024,
  },
});

// GET /api/books
router.get("/", requireAuth, async (req, res) => {
  const user = res.locals.user;
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/books/:id
router.get("/:id", requireAuth, async (req, res) => {
  const user = res.locals.user;
  const { data: book, error } = await supabase
    .from("books")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !book)
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });

  const { data: chapters } = await supabase
    .from("chapters")
    .select("*")
    .eq("book_id", book.id)
    .order("index", { ascending: true });

  // Generate signed URLs for done chapters
  const chaptersWithUrls = await Promise.all(
    (chapters ?? []).map(async (ch: any) => {
      if (ch.audio_path) {
        const { data: signed } = await supabase.storage
          .from("audio")
          .createSignedUrl(ch.audio_path, 60 * 60 * 24);
        return { ...ch, audio_url: signed?.signedUrl ?? null };
      }
      return { ...ch, audio_url: null };
    }),
  );

  // Generate signed URL for the EPUB file. Support both stored path and direct public URL.
  let epubUrl: string | null = null;
  const epubSource = book.epub_path ?? book.epub_url ?? null;
  if (epubSource) {
    if (typeof epubSource === "string" && /^https?:\/\//.test(epubSource)) {
      epubUrl = epubSource;
    } else {
      const { data: signed } = await supabase.storage
        .from("epubs")
        .createSignedUrl(epubSource as string, 60 * 60 * 24);
      epubUrl = signed?.signedUrl ?? null;
    }
  }

  res.json({ ...book, epub_url: epubUrl, chapters: chaptersWithUrls });
});

// POST /api/books/upload
router.post("/upload", requireAuth, upload.single("epub"), async (req, res) => {
  const user = res.locals.user;

  if (!req.file)
    return res.status(400).json({ error: "No file uploaded", code: "NO_FILE" });
  if (!req.file.originalname.endsWith(".epub")) {
    return res
      .status(400)
      .json({ error: "Invalid EPUB", code: "INVALID_EPUB" });
  }

  const tmpPath = path.join(os.tmpdir(), `upload-${Date.now()}.epub`);
  let epub: any;
  try {
    fs.writeFileSync(tmpPath, req.file.buffer);
    epub = await EPub.createAsync(tmpPath);
  } catch {
    fs.rmSync(tmpPath, { force: true });
    return res
      .status(400)
      .json({ error: "Failed to parse EPUB", code: "INVALID_EPUB" });
  }

  const metadata = epub.metadata;
  const title =
    (typeof metadata.title === "string" ? metadata.title : null) ?? "Untitled";
  const rawCreator = metadata.creator;
  const author =
    (typeof rawCreator === "string"
      ? rawCreator
      : typeof rawCreator === "object" && rawCreator !== null
        ? ((rawCreator as any)._ ??
          (rawCreator as any)["file-as"] ??
          Object.values(rawCreator as any)[0])
        : null) ?? "Unknown";

  // Insert book record immediately so we can respond fast
  const { data: book, error: bookError } = await supabase
    .from("books")
    .insert({ user_id: user.id, title, author, status: "done" }) // Changed to "done" since no TTS processing
    .select()
    .single();

  if (bookError || !book) {
    return res
      .status(500)
      .json({ error: "Failed to create book", code: "DB_ERROR" });
  }

  // Respond immediately — all heavy work happens in background
  res.status(201).json(book);

  // ── Background processing ─────────────────────────────────────────────────
  (async () => {
    console.log(`🔄 Starting background processing for book "${title}"`);
    const epubBuffer = fs.readFileSync(tmpPath);

    // Upload epub to storage
    const epubStoragePath = `${user.id}/${book.id}.epub`;
    await supabase.storage.from("epubs").upload(epubStoragePath, epubBuffer, {
      contentType: "application/epub+zip",
    });
    await supabase
      .from("books")
      .update({ epub_path: epubStoragePath })
      .eq("id", book.id);

    // Extract & upload cover image
    const manifest: Record<
      string,
      { id: string; href: string; mediaType: string }
    > = epub.manifest;
    const coverImageId =
      metadata.cover ||
      Object.values(manifest).find(
        (m) =>
          m.mediaType?.startsWith("image/") && /cover/i.test(m.id + m.href),
      )?.id;

    if (coverImageId) {
      try {
        const [imgBuffer, mimeType] = await epub.getImageAsync(coverImageId);
        const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
        const coverPath = `${book.id}/cover.${ext}`;
        await supabase.storage.from("covers").upload(coverPath, imgBuffer, {
          contentType: mimeType,
          upsert: true,
        });
        const {
          data: { publicUrl },
        } = supabase.storage.from("covers").getPublicUrl(coverPath);
        await supabase
          .from("books")
          .update({ cover_url: publicUrl })
          .eq("id", book.id);
      } catch {
        /* not fatal */
      }
    }

    // Build a map from manifest id → TOC title using epub's NCX nav map
    const tocEntries = (epub.toc ?? []) as {
      id: string;
      title: string;
      order: number;
      level: number;
    }[];
    const tocTitleById = new Map<string, string>();
    for (const entry of tocEntries) {
      if (entry.id && entry.title)
        tocTitleById.set(entry.id, entry.title.trim());
    }

    // Extract chapters with inline images
    const flow = epub.flow as {
      id: string;
      href: string;
      mediaType?: string;
    }[];

    // IDs that are clearly nav/CSS artifacts (e.g. c64, c84, nav, toc, cover pages)
    const artifactIdPattern =
      /^(c\d+|nav\b|toc\b|cover|copyright|titlepage|halftitle|dedication|colophon|index\b)/i;

    // Extract all CSS files from the EPUB manifest and concatenate them
    const cssItems = Object.values(manifest).filter(
      (m) => m.mediaType === "text/css",
    );
    let epubCss = "";
    for (const cssItem of cssItems) {
      try {
        const cssContent = await new Promise<string>((resolve, reject) => {
          epub.getFile(cssItem.id, (err: any, data: Buffer) => {
            if (err) reject(err);
            else resolve(data.toString("utf-8"));
          });
        });
        epubCss += cssContent + "\n";
      } catch {
        /* skip */
      }
    }

    console.log(`📚 Processing ${flow.length} flow items`);
    const chapterTexts: {
      index: number;
      href: string;
      title: string;
      text: string;
      spans: FormatSpan[];
      html: string;
      images: { url: string; afterChar: number }[];
    }[] = [];

    for (let i = 0; i < flow.length; i++) {
      const flowItem = flow[i];

      // Skip non-HTML items and known artifact IDs
      if (flowItem.mediaType && !flowItem.mediaType.includes("html")) continue;
      if (artifactIdPattern.test(flowItem.id)) continue;

      try {
        const rawHtml = await new Promise<string>((resolve, reject) => {
          epub.getChapterRaw(flowItem.id, (err: any, data: string) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        const { text, spans } = extractSpans(rawHtml);
        const sentenceCount = (text.match(/[.!?]\s/g) ?? []).length;
        const isBoilerplate =
          /all rights reserved|work of fiction|no part of this/i.test(text);

        console.log(
          `  [${flowItem.id}] len=${text.length} sentences=${sentenceCount} boilerplate=${isBoilerplate}`,
        );

        if (text.length < 500 || sentenceCount < 5 || isBoilerplate) {
          console.log(`  [${flowItem.id}] SKIPPED`);
          continue;
        }

        // Extract inline image positions
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        const inlineImages: { url: string; afterChar: number }[] = [];
        const imageUrlBySrc = new Map<string, string>();
        let textCursor = 0;
        let lastIndex = 0;
        let imgMatch: RegExpExecArray | null;

        while ((imgMatch = imgRegex.exec(rawHtml)) !== null) {
          const beforeImg = rawHtml.slice(lastIndex, imgMatch.index);
          textCursor += he.decode(
            beforeImg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
          ).length;

          const imgSrc = imgMatch[1];
          const imgItem = Object.values(manifest).find(
            (m) =>
              m.mediaType?.startsWith("image/") &&
              (m.href.endsWith(imgSrc) ||
                imgSrc.endsWith(m.href) ||
                imgSrc.includes(m.id)),
          );
          if (imgItem) {
            try {
              const [imgBuffer, mimeType] = await epub.getImageAsync(
                imgItem.id,
              );
              const ext =
                mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
              const imgPath = `${book.id}/${imgItem.id}.${ext}`;
              await supabase.storage.from("covers").upload(imgPath, imgBuffer, {
                contentType: mimeType,
                upsert: true,
              });
              const {
                data: { publicUrl },
              } = supabase.storage.from("covers").getPublicUrl(imgPath);
              if (publicUrl) {
                imageUrlBySrc.set(imgSrc, publicUrl);
                inlineImages.push({ url: publicUrl, afterChar: textCursor });
              }
            } catch {
              /* skip */
            }
          }
          lastIndex = imgMatch.index + imgMatch[0].length;
        }

        const htmlWithPublicImages = rewriteImageSources(
          rawHtml,
          imageUrlBySrc,
        );
        const preservedHtml = sanitizeHtmlForStorage(htmlWithPublicImages);

        const tocTitle = tocTitleById.get(flowItem.id);
        const firstLine = text.split("\n")[0].trim();
        const title =
          tocTitle ??
          (firstLine.length < 60 ? firstLine : null) ??
          `Chapter ${chapterTexts.length + 1}`;

        console.log(`  [${flowItem.id}] KEPT as "${title}"`);
        chapterTexts.push({
          index: i,
          href: flowItem.href ?? "",
          title,
          text,
          spans,
          html: preservedHtml,
          images: inlineImages,
        });
      } catch (err) {
        console.error(`  [${flowItem.id}] ERROR:`, err);
      }
    }

    if (chapterTexts.length === 0) {
      await supabase.from("books").update({ status: "done" }).eq("id", book.id);
      return;
    }

    const { data: chapters, error: insertError } = await supabase
      .from("chapters")
      .insert(
        chapterTexts.map((ch) => ({
          book_id: book.id,
          index: ch.index,
          title: ch.title,
          text: ch.text,
          html: ch.html,
          images: ch.images,
          status: "done",
        })),
      )
      .select();

    if (insertError) console.error(`❌ Chapter insert error:`, insertError);
    console.log(
      `✅ Inserted ${chapters?.length || 0} chapters for book "${title}"`,
    );

    // Store book-level TOC: ordered list of { title, chapterIndex, href } for the player
    const bookToc = chapterTexts.map((ch, i) => ({
      title: ch.title,
      chapterIndex: i,
      href: ch.href,
    }));

    const { error: bookUpdateError } = await supabase
      .from("books")
      .update({
        total_chapters: chapterTexts.length,
        toc: bookToc,
        stylesheet: epubCss || null,
      })
      .eq("id", book.id);

    if (bookUpdateError)
      console.error(`❌ Book update error:`, bookUpdateError);

    // TEMPORARILY DISABLED: TTS processing for testing parsing
    // for (const ch of chapters ?? []) {
    //   await ttsQueue.add("tts", {
    //     chapterId: ch.id,
    //     bookId: book.id,
    //     text: ch.text,
    //   });
    // }

    console.log(
      `📖 Book "${title}" uploaded with ${chapterTexts.length} chapters - parsing complete, TTS disabled for testing`,
    );
  })()
    .catch((error) => {
      console.error(
        `❌ Background processing failed for book "${title}":`,
        error,
      );
    })
    .finally(() => {
      console.log(`🧹 Cleaning up temp file for book "${title}"`);
      fs.rmSync(tmpPath, { force: true });
    });
});

// DELETE /api/books/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const user = res.locals.user;

  const { data: book } = await supabase
    .from("books")
    .select("id")
    .eq("id", req.params.id)
    .eq("user_id", user.id)
    .single();

  if (!book)
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });

  // Delete audio files from storage
  const { data: chapters } = await supabase
    .from("chapters")
    .select("audio_path")
    .eq("book_id", book.id)
    .not("audio_path", "is", null);

  if (chapters?.length) {
    await supabase.storage
      .from("audio")
      .remove(chapters.map((c: any) => c.audio_path));
  }

  // Delete epub
  await supabase.storage.from("epubs").remove([`${user.id}/${book.id}.epub`]);

  // Cascade deletes chapters via DB foreign key
  await supabase.from("books").delete().eq("id", book.id);

  res.status(204).send();
});

// GET /api/books/:id/jobs
router.get("/:id/jobs", requireAuth, async (req, res) => {
  const user = res.locals.user;

  const { data: book } = await supabase
    .from("books")
    .select("id")
    .eq("id", req.params.id)
    .eq("user_id", user.id)
    .single();

  if (!book)
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });

  const { data: chapters } = await supabase
    .from("chapters")
    .select("id, index, status, updated_at")
    .eq("book_id", book.id)
    .order("index");

  const jobs = (chapters ?? []).map((ch: any) => ({
    chapter_id: ch.id,
    chapter_index: ch.index,
    status: ch.status,
    completed_at: ch.status === "done" ? ch.updated_at : null,
    error: null,
  }));

  const counts = jobs.reduce((acc: any, j: any) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

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
router.post(
  "/:bookId/chapters/:chapterId/retry",
  requireAuth,
  async (req, res) => {
    const user = res.locals.user;

    const { data: book } = await supabase
      .from("books")
      .select("id")
      .eq("id", req.params.bookId)
      .eq("user_id", user.id)
      .single();

    if (!book)
      return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });

    const { data: chapter } = await supabase
      .from("chapters")
      .select("*")
      .eq("id", req.params.chapterId)
      .eq("book_id", book.id)
      .single();

    if (!chapter)
      return res
        .status(404)
        .json({ error: "Chapter not found", code: "NOT_FOUND" });

    await supabase
      .from("chapters")
      .update({ status: "pending" })
      .eq("id", chapter.id);

    const job = await ttsQueue.add("tts", {
      chapterId: chapter.id,
      bookId: book.id,
      text: chapter.text,
    });

    res.status(202).json({ job_id: job.id, status: "pending" });
  },
);

export default router;
