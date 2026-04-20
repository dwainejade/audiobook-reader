# Text Parsing Test Tool

This tool allows you to test the text extraction and parsing logic used in the audiobook reader before audio synthesis with Kokoro TTS.

## Usage

```bash
node test-parser.js <path-to-file>
```

Supported file types:

- `.epub` - EPUB ebooks
- `.html` - HTML files (for testing individual chapters)

## What it shows

1. **Chapter Information**: Title, character count, sentence count, formatting spans
2. **Extracted Text**: The clean text that would be sent to Kokoro TTS
3. **Text Chunking**: How the text is split into chunks for TTS processing (max 1000 chars per chunk)
4. **Formatting Analysis**: Which parts of the text have bold, italic, or underline formatting

## Examples

```bash
# Test an EPUB file
node test-parser.js mybook.epub

# Test a single HTML chapter
node test-parser.js chapter1.html
```

## Understanding the Output

- **Characters**: Total character count of extracted text
- **Sentences**: Number of sentences (used for filtering short/thin content)
- **Formatting spans**: Ranges of text with special formatting (bold, italic, underline)
- **Chunks**: Text is split at sentence boundaries to stay under 1000 characters per chunk

## Modifying the Parser

The parsing logic is in the `extractSpans()` function. Key features:

- Removes HTML tags while preserving text content
- Handles formatting (bold, italic, underline) by tracking spans
- Adds paragraph breaks after block elements and headings
- Filters out boilerplate content (copyright notices, etc.)
- Normalizes whitespace

To modify parsing behavior, edit the `extractSpans()` function in `test-parser.js`.
