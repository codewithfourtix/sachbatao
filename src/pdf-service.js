const { PDFParse } = require('pdf-parse');
const logger = require('./logger');

const MAX_PAGES = 3;

class PDFService {
  // Extract text from only the first `maxPages` pages of a PDF buffer.
  // A fresh PDFParse instance is used per call, so sequential parses over the
  // bot's lifetime stay independent. Returns { text, totalPages, pagesChecked, truncated }.
  async extractFirstPages(buffer, maxPages = MAX_PAGES) {
    if (!buffer || !buffer.length) {
      throw new Error('No PDF data to process');
    }

    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText({ first: maxPages });

      const totalPages = result.total || (result.pages ? result.pages.length : 0);
      const text = (result.pages || [])
        .map((p) => (p && p.text ? p.text : ''))
        .join('\n')
        .trim();
      const pagesChecked = totalPages ? Math.min(totalPages, maxPages) : maxPages;
      const truncated = totalPages > maxPages;

      logger.info('PDF text extracted', { totalPages, pagesChecked, chars: text.length });

      return { text, totalPages, pagesChecked, truncated };
    } finally {
      await parser.destroy();
    }
  }
}

module.exports = { PDFService, MAX_PAGES };
