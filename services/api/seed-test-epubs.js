#!/usr/bin/env node
// Seeds all EPUBs from test-epubs/ into the database using the same logic as the upload route.
// Usage: node scripts/seed-test-epubs.js

const { EPub } = require("epub2");
const { createClient } = require("@supabase/supabase-js");
const he = require("he");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://txcwlczwdvddgmijlkgo.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4Y3dsY3p3ZHZkZGdtaWpsa2dvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYyNDM2NSwiZXhwIjoyMDkyMjAwMzY1fQ.SME_D_wFQ6o00F4mZ6vGWw8gB7ULaPo5dmwDcO49V1A";
const USER_ID = "295ec348-6272-44e1-a934-dd1f653b231c";
const EPUBS_DIR = path.join(__dirname, "../../test-epubs");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Same helpers as books.ts ──────────────────────────────────────────────────

const BOLD_TAGS = new Set(["b", "strong"]);
const ITALIC_TAGS = new Set(["i", "em", "cite"]);
const UNDERLINE_TAGS = new Set(["u", "ins"]);
const BLOCK_TAGS = new Set(["p", "div", "blockquote", "li", "tr", "td", "th"]);
const SKIP_TAGS = new Set(["title", "style", "script", "meta", "link"]);

function extractSpans(rawHtml) {
  const html = rawHtml
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(style|script|title|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(meta|link)[^>]*\/?>/gi, "");

  const TOKEN_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>|([^<]+)/g;
  let buf = "";
  const stack = [];
  const rawSpans = [];
  let skipDepth = 0;
  let m;

  while ((m = TOKEN_RE.exec(html)) !== null) {
    const [, closing, tagName, textNode] = m;
    const tag = tagName?.toLowerCase();
    if (textNode !== undefined) {
      if (skipDepth === 0) buf += he.decode(textNode.replace(/\s+/g, " "));
      continue;
    }
    if (closing) {
      if (SKIP_TAGS.has(tag)) { skipDepth = Math.max(0, skipDepth - 1); continue; }
      if (skipDepth > 0) continue;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const entry = stack.splice(i, 1)[0];
          if (entry.openedAt < buf.length) {
            const span = { charStart: entry.openedAt, charEnd: buf.length };
            if (entry.kind === "bold") span.bold = true;
            if (entry.kind === "italic") span.italic = true;
            if (entry.kind === "underline") span.underline = true;
            rawSpans.push(span);
          }
          break;
        }
      }
      if (/^h[1-6]$/.test(tag)) { buf += "##"; if (!buf.endsWith("\n")) buf += "\n\n"; }
      else if (BLOCK_TAGS.has(tag)) { if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n"; }
    } else {
      if (SKIP_TAGS.has(tag)) { skipDepth++; continue; }
      if (skipDepth > 0) continue;
      if (/^h[1-6]$/.test(tag)) {
        if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n";
        buf += "##";
        stack.push({ tag, kind: "bold", openedAt: buf.length });
      } else if (BLOCK_TAGS.has(tag)) {
        if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n";
      } else if (tag === "br") {
        buf += "\n";
      } else if (BOLD_TAGS.has(tag)) {
        stack.push({ tag, kind: "bold", openedAt: buf.length });
      } else if (ITALIC_TAGS.has(tag)) {
        stack.push({ tag, kind: "italic", openedAt: buf.length });
      } else if (UNDERLINE_TAGS.has(tag)) {
        stack.push({ tag, kind: "underline", openedAt: buf.length });
      }
    }
  }

  const text = buf
    .replace(/[ \t]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n /g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  rawSpans.sort((a, b) => a.charStart - b.charStart);
  const spans = [];
  for (const s of rawSpans) {
    const last = spans[spans.length - 1];
    if (last && last.charEnd >= s.charStart && last.bold === s.bold &&
        last.italic === s.italic && last.underline === s.underline) {
      last.charEnd = Math.max(last.charEnd, s.charEnd);
    } else {
      spans.push({ ...s });
    }
  }
  return { text, spans };
}

function sanitizeHtmlForStorage(rawHtml) {
  return rawHtml
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<(script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(meta|link)[^>]*\/?>(\s*)/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
}

function rewriteImageSources(rawHtml, srcMap) {
  if (srcMap.size === 0) return rawHtml;
  return rawHtml.replace(
    /<img([^>]*?)src=(['"])([^"']+)\2([^>]*)>/gi,
    (_, before, quote, src, after) => {
      const url = srcMap.get(src);
      return url ? `<img${before}src=${quote}${url}${quote}${after}>` : _;
    }
  );
}

// ── Process one EPUB ──────────────────────────────────────────────────────────

async function processEpub(epubPath) {
  const filename = path.basename(epubPath);
  console.log(`\n📖 Processing: ${filename}`);

  const epub = await EPub.createAsync(epubPath);
  const metadata = epub.metadata;
  const manifest = epub.manifest;

  const title = (typeof metadata.title === "string" ? metadata.title : null) ?? path.basename(epubPath, ".epub");
  const rawCreator = metadata.creator;
  const author =
    (typeof rawCreator === "string" ? rawCreator :
     typeof rawCreator === "object" && rawCreator !== null
       ? (rawCreator._ ?? rawCreator["file-as"] ?? Object.values(rawCreator)[0])
       : null) ?? "Unknown";

  console.log(`  Title: "${title}" | Author: "${author}"`);

  // Delete existing book with same title for this user
  const { data: existing } = await supabase
    .from("books")
    .select("id")
    .eq("user_id", USER_ID)
    .eq("title", title)
    .maybeSingle();
  if (existing) {
    console.log(`  Deleting existing book ${existing.id}…`);
    await supabase.from("books").delete().eq("id", existing.id);
  }

  // Insert book record
  const { data: book, error: bookErr } = await supabase
    .from("books")
    .insert({ user_id: USER_ID, title, author, status: "done" })
    .select()
    .single();
  if (bookErr || !book) { console.error("  ❌ Book insert failed:", bookErr); return; }
  console.log(`  Book ID: ${book.id}`);

  // Upload EPUB file to storage
  const epubBuffer = fs.readFileSync(epubPath);
  const epubStoragePath = `${USER_ID}/${book.id}.epub`;
  const { error: epubUploadErr } = await supabase.storage
    .from("epubs")
    .upload(epubStoragePath, epubBuffer, { contentType: "application/epub+zip", upsert: true });
  if (epubUploadErr) console.log(`  EPUB upload failed: ${epubUploadErr.message}`);
  else console.log(`  EPUB uploaded to ${epubStoragePath}`);

  // Extract CSS
  const cssItems = Object.values(manifest).filter(m => m.mediaType === "text/css");
  let epubCss = "";
  for (const cssItem of cssItems) {
    try {
      const cssContent = await new Promise((resolve, reject) => {
        epub.getFile(cssItem.id, (err, data) => err ? reject(err) : resolve(data.toString("utf-8")));
      });
      epubCss += cssContent + "\n";
    } catch { /* skip */ }
  }
  console.log(`  CSS: ${Math.round(epubCss.length / 1024)}KB from ${cssItems.length} file(s)`);

  // Cover
  const coverImageId = metadata.cover ||
    Object.values(manifest).find(m => m.mediaType?.startsWith("image/") && /cover/i.test(m.id + m.href))?.id;
  if (coverImageId) {
    try {
      const [imgBuffer, mimeType] = await epub.getImageAsync(coverImageId);
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      const coverPath = `${book.id}/cover.${ext}`;
      await supabase.storage.from("covers").upload(coverPath, imgBuffer, { contentType: mimeType, upsert: true });
      const { data: { publicUrl } } = supabase.storage.from("covers").getPublicUrl(coverPath);
      await supabase.from("books").update({ cover_url: publicUrl }).eq("id", book.id);
      console.log(`  Cover uploaded`);
    } catch (e) { console.log(`  Cover failed: ${e.message}`); }
  }

  // TOC
  const tocEntries = epub.toc ?? [];
  const tocTitleById = new Map();
  for (const entry of tocEntries) {
    if (entry.id && entry.title) tocTitleById.set(entry.id, entry.title.trim());
  }

  // Artifact filter
  const artifactIdPattern = /^(c\d+|nav\b|toc\b|cover|copyright|titlepage|halftitle|dedication|colophon|index\b)/i;

  const flow = epub.flow;
  const chapterTexts = [];

  for (let i = 0; i < flow.length; i++) {
    const flowItem = flow[i];
    if (flowItem.mediaType && !flowItem.mediaType.includes("html")) continue;
    if (artifactIdPattern.test(flowItem.id)) continue;

    try {
      const rawHtml = await new Promise((resolve, reject) => {
        epub.getChapterRaw(flowItem.id, (err, data) => err ? reject(err) : resolve(data));
      });

      const { text, spans } = extractSpans(rawHtml);
      const sentenceCount = (text.match(/[.!?]\s/g) ?? []).length;
      const isBoilerplate = /all rights reserved|work of fiction|no part of this/i.test(text);

      if (text.length < 500 || sentenceCount < 5 || isBoilerplate) {
        console.log(`  [${flowItem.id}] SKIP (len=${text.length} sents=${sentenceCount} bp=${isBoilerplate})`);
        continue;
      }

      // Images
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const inlineImages = [];
      const imageUrlBySrc = new Map();
      let textCursor = 0, lastIndex = 0, imgMatch;

      while ((imgMatch = imgRegex.exec(rawHtml)) !== null) {
        const beforeImg = rawHtml.slice(lastIndex, imgMatch.index);
        textCursor += he.decode(beforeImg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).length;
        const imgSrc = imgMatch[1];
        const imgItem = Object.values(manifest).find(m =>
          m.mediaType?.startsWith("image/") &&
          (m.href.endsWith(imgSrc) || imgSrc.endsWith(m.href) || imgSrc.includes(m.id))
        );
        if (imgItem) {
          try {
            const [imgBuffer, mimeType] = await epub.getImageAsync(imgItem.id);
            const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
            const imgPath = `${book.id}/${imgItem.id}.${ext}`;
            await supabase.storage.from("covers").upload(imgPath, imgBuffer, { contentType: mimeType, upsert: true });
            const { data: { publicUrl } } = supabase.storage.from("covers").getPublicUrl(imgPath);
            if (publicUrl) { imageUrlBySrc.set(imgSrc, publicUrl); inlineImages.push({ url: publicUrl, afterChar: textCursor }); }
          } catch { /* skip */ }
        }
        lastIndex = imgMatch.index + imgMatch[0].length;
      }

      const preservedHtml = sanitizeHtmlForStorage(rewriteImageSources(rawHtml, imageUrlBySrc));
      const tocTitle = tocTitleById.get(flowItem.id);
      const firstLine = text.split("\n")[0].trim();
      const chTitle = tocTitle ?? (firstLine.length < 60 ? firstLine : null) ?? `Chapter ${chapterTexts.length + 1}`;

      console.log(`  [${flowItem.id}] KEEP "${chTitle}" (len=${text.length} sents=${sentenceCount})`);
      chapterTexts.push({ index: i, title: chTitle, text, spans, html: preservedHtml, images: inlineImages });
    } catch (err) {
      console.error(`  [${flowItem.id}] ERROR:`, err.message);
    }
  }

  console.log(`  Total chapters kept: ${chapterTexts.length}`);
  if (chapterTexts.length === 0) {
    await supabase.from("books").update({ status: "done" }).eq("id", book.id);
    return;
  }

  // Insert chapters
  const { data: inserted, error: chapErr } = await supabase
    .from("chapters")
    .insert(chapterTexts.map(ch => ({
      book_id: book.id,
      index: ch.index,
      title: ch.title,
      text: ch.text,
      html: ch.html,
      images: ch.images,
      status: "done",
    })))
    .select("id");

  if (chapErr) { console.error("  ❌ Chapter insert error:", chapErr.message); return; }
  console.log(`  ✅ Inserted ${inserted?.length} chapters`);

  // Update book with TOC + CSS
  const { error: updateErr } = await supabase
    .from("books")
    .update({
      total_chapters: chapterTexts.length,
      toc: chapterTexts.map((ch, i) => ({ title: ch.title, chapterIndex: i })),
      stylesheet: epubCss || null,
      epub_path: epubStoragePath,
    })
    .eq("id", book.id);

  if (updateErr) console.error("  ❌ Book update error:", updateErr.message);
  else console.log(`  ✅ Book updated`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(EPUBS_DIR).filter(f => f.endsWith(".epub"));
  console.log(`Found ${files.length} EPUBs in test-epubs/`);

  for (const file of files) {
    await processEpub(path.join(EPUBS_DIR, file));
  }
  console.log("\n✅ Done");
}

main().catch(console.error);
