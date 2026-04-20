#!/usr/bin/env node

/**
 * Test script to parse text extraction and show what would be sent to Kokoro TTS
 * Usage: node test-parser.js <path-to-epub-or-html>
 */

const { EPub } = require("epub2");
const fs = require("fs");
const path = require("path");
const he = require("he");

// ── Rich-text span extraction (copied from books.ts) ─────────────────────────────────────────────────

const BOLD_TAGS = new Set(["b", "strong"]);
const ITALIC_TAGS = new Set(["i", "em", "cite"]);
const UNDERLINE_TAGS = new Set(["u", "ins"]);
const BLOCK_TAGS = new Set(["p", "div", "blockquote", "li", "tr", "td", "th"]);
// Tags whose inner text should be completely skipped
const SKIP_TAGS = new Set(["title", "style", "script", "meta", "link"]);

function extractSpans(rawHtml) {
    // Strip XML declaration, DOCTYPE, and head section entirely
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
    let skipDepth = 0; // >0 means we're inside a skip tag

    let m;
    while ((m = TOKEN_RE.exec(html)) !== null) {
        const [, closing, tagName, textNode] = m;
        const tag = tagName?.toLowerCase();

        if (textNode !== undefined) {
            if (skipDepth === 0) {
                const decoded = he.decode(textNode.replace(/\s+/g, " "));
                const normalized = decoded.trim().toLowerCase();

                // 👇 prevent duplicate heading bleed
                const lastLine = buf.trim().split("\n").pop()?.toLowerCase();

                if (lastLine && normalized === lastLine) {
                    continue; // skip duplicate heading text
                }

                buf += decoded;
            }
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
                        const span = {
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
            // Heading close → paragraph break ONLY
            if (/^h[1-6]$/.test(tag)) {
                if (buf.length > 0 && !buf.endsWith("\n")) buf += "\n\n";
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

    // Normalise whitespace in the assembled text
    const text = buf
        .replace(/[ \t]+/g, " ")
        .replace(/ \n/g, "\n")
        .replace(/\n /g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    // Merge adjacent/overlapping spans with the same flags, sort by start
    rawSpans.sort((a, b) => a.charStart - b.charStart);
    const spans = [];
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

async function testParse(filePath) {
    console.log(`Parsing file: ${filePath}\n`);

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.epub') {
        await testParseEpub(filePath);
    } else if (ext === '.html' || ext === '.htm') {
        await testParseHtml(filePath);
    } else {
        console.error('Unsupported file type. Use .epub or .html files.');
        process.exit(1);
    }
}

async function testParseEpub(epubPath) {
    const epub = await EPub.createAsync(epubPath);
    const metadata = epub.metadata;
    const title = typeof metadata.title === "string" ? metadata.title : "Untitled";
    const author = typeof metadata.creator === "string" ? metadata.creator : "Unknown";

    console.log(`📖 Book: ${title}`);
    console.log(`👤 Author: ${author}\n`);

    // Build a map from manifest id → TOC title using epub's NCX nav map
    const tocEntries = (epub.toc ?? []);
    const tocTitleById = new Map();
    for (const entry of tocEntries) {
        if (entry.id && entry.title)
            tocTitleById.set(entry.id, entry.title.trim());
    }

    // Extract chapters
    const flow = epub.flow;

    // IDs that are clearly nav/CSS artifacts
    const artifactIdPattern =
        /^(c\d+|nav\b|toc\b|cover|copyright|titlepage|halftitle|dedication|colophon|index\b)/i;

    const chapters = [];

    for (let i = 0; i < flow.length; i++) {
        const flowItem = flow[i];

        // Skip non-HTML items and known artifact IDs
        if (flowItem.mediaType && !flowItem.mediaType.includes("html")) continue;
        if (artifactIdPattern.test(flowItem.id)) continue;

        try {
            const rawHtml = await new Promise((resolve, reject) => {
                epub.getChapterRaw(flowItem.id, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });

            const { text, spans } = extractSpans(rawHtml);

            // Skip boilerplate and thin content
            const sentenceCount = (text.match(/[.!?]\s/g) ?? []).length;
            const isBoilerplate =
                /all rights reserved|copyright|work of fiction|no part of this/i.test(
                    text,
                );
            if (text.length < 500 || sentenceCount < 5 || isBoilerplate) continue;

            // Title: prefer NCX TOC entry, then first bold/heading span text, then fallback
            const tocTitle = tocTitleById.get(flowItem.id);
            const firstLine = text.split("\n")[0].trim();
            const title =
                tocTitle ??
                (firstLine.length < 60 ? firstLine : null) ??
                `Chapter ${chapters.length + 1}`;

            chapters.push({
                index: i,
                id: flowItem.id,
                title,
                text,
                spans,
                charCount: text.length,
                sentenceCount,
            });
        } catch (err) {
            console.warn(`⚠️  Skipped chapter ${flowItem.id}: ${err.message}`);
        }
    }

    displayChapters(chapters);
}

async function testParseHtml(htmlPath) {
    console.log(`📄 Testing HTML file: ${path.basename(htmlPath)}\n`);

    const rawHtml = fs.readFileSync(htmlPath, 'utf8');
    const { text, spans } = extractSpans(rawHtml);

    // Skip boilerplate and thin content
    const sentenceCount = (text.match(/[.!?]\s/g) ?? []).length;
    const isBoilerplate =
        /all rights reserved|copyright|work of fiction|no part of this/i.test(
            text,
        );

    const chapters = [{
        index: 0,
        id: 'test',
        title: path.basename(htmlPath, path.extname(htmlPath)),
        text,
        spans,
        charCount: text.length,
        sentenceCount,
    }];

    if (text.length < 100 || sentenceCount < 1 || isBoilerplate) {
        console.log('⚠️  Content appears to be boilerplate or too short, but showing anyway for testing...\n');
    }

    displayChapters(chapters);
}

function displayChapters(chapters) {
    console.log(`📚 Found ${chapters.length} chapters:\n`);

    chapters.forEach((ch, idx) => {
        console.log(`${idx + 1}. ${ch.title}`);
        console.log(`   ID: ${ch.id}`);
        console.log(`   Characters: ${ch.charCount.toLocaleString()}`);
        console.log(`   Sentences: ${ch.sentenceCount}`);
        console.log(`   Formatting spans: ${ch.spans.length}`);

        // Show first 500 chars of text that would go to Kokoro
        const preview = ch.text.substring(0, 500);
        console.log(`   Text preview: "${preview}${ch.text.length > 500 ? '...' : ''}"`);

        // Show formatting spans
        if (ch.spans.length > 0) {
            console.log(`   Formatting:`);
            ch.spans.slice(0, 5).forEach(span => {
                const spanText = ch.text.substring(span.charStart, span.charEnd);
                const format = [];
                if (span.bold) format.push('bold');
                if (span.italic) format.push('italic');
                if (span.underline) format.push('underline');
                console.log(`     ${format.join(', ')}: "${spanText.substring(0, 50)}${spanText.length > 50 ? '...' : ''}"`);
            });
            if (ch.spans.length > 5) {
                console.log(`     ... and ${ch.spans.length - 5} more spans`);
            }
        }

        console.log('');
    });

    // Summary stats
    const totalChars = chapters.reduce((sum, ch) => sum + ch.charCount, 0);
    const totalSentences = chapters.reduce((sum, ch) => sum + ch.sentenceCount, 0);
    const avgCharsPerChapter = Math.round(totalChars / chapters.length);

    console.log(`📊 Summary:`);
    console.log(`   Total chapters: ${chapters.length}`);
    console.log(`   Total characters: ${totalChars.toLocaleString()}`);
    console.log(`   Total sentences: ${totalSentences}`);
    console.log(`   Average chars/chapter: ${avgCharsPerChapter.toLocaleString()}`);

    // Show what would be sent to Kokoro TTS (first chapter as example)
    if (chapters.length > 0) {
        console.log(`\n🎵 What would be sent to Kokoro TTS (Chapter 1):`);
        console.log('='.repeat(80));

        const text = chapters[0].text;
        console.log(`Original text (${text.length} chars):`);
        console.log(text);
        console.log('='.repeat(80));

        // Simulate the chunking logic from worker.py
        const MAX_CHUNK_CHARS = 1000;
        const sentences = text.split(/[.!?]\s+/).filter(s => s.trim());
        const chunks = [];
        let current = "";

        for (const sentence of sentences) {
            if (current.length + sentence.length + 1 > MAX_CHUNK_CHARS && current) {
                chunks.push(current);
                current = sentence;
            } else {
                current = (current + " " + sentence).trim();
            }
        }
        if (current) {
            chunks.push(current);
        }

        console.log(`\n📦 Text would be split into ${chunks.length} chunk(s) for TTS:`);
        chunks.forEach((chunk, i) => {
            console.log(`\nChunk ${i + 1} (${chunk.length} chars):`);
            console.log(`"${chunk}"`);
        });

        console.log('\n🎯 Each chunk would be sent separately to Kokoro for synthesis.');
    }
}

// CLI
const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: node test-parser.js <path-to-epub-or-html>');
    console.error('Examples:');
    console.error('  node test-parser.js mybook.epub');
    console.error('  node test-parser.js chapter.html');
    process.exit(1);
}

testParse(filePath).catch(console.error);