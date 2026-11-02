import { SourceAdapter, Candidate } from '../types.js';

/**
 * Buying for Victoria (tenders.vic.gov.au) "Current Tenders" adapter.
 *
 * The portal is Cloudflare-walled for direct clients, but Jina Reader can
 * return the raw HTML when asked with X-Respond-With: html. This adapter
 * parses the server-rendered tender table into Candidate objects.
 */
export class VicTendersOpenAdapter implements SourceAdapter {
  name = 'vicTendersOpen';
  private readonly jinaBase: string;
  private readonly listPath: string;
  private readonly origin: string;

  constructor(options?: {
    jinaBase?: string;
    listPath?: string;
    origin?: string;
  }) {
    this.jinaBase =
      options?.jinaBase ?? 'https://r.jina.ai/http://www.tenders.vic.gov.au';
    this.listPath = options?.listPath ?? '/tenders/open';
    this.origin = options?.origin ?? 'https://www.tenders.vic.gov.au';
  }

  async discover(): Promise<Candidate[]> {
    const url = `${this.jinaBase}${this.listPath}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; client-hunter/0.1)',
        'X-Respond-With': 'html',
      },
    });
    if (!res.ok) {
      throw new Error(`VIC tenders open fetch failed: ${res.status}`);
    }
    const html = await res.text();
    return this.parseOpenList(html);
  }

  parseOpenList(html: string): Candidate[] {
    const candidates: Candidate[] = [];
    const rowRe =
      /<tr[^>]*?\bid="tenderRow(\d+)"[^>]*?\bdata-tender-code="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(html)) !== null) {
      const [, tenderId, rfxNumber, rowHtml] = rowMatch;
      const title = this.extractText(
        rowHtml,
        /\bclass="[^"]*\btenderRowTitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const detailHref = this.extractAttr(
        rowHtml,
        /<a\b(?=[^>]*\bclass="[^"]*\btenderRowTitle\b")[^>]*\bhref="([^"]*)"/i,
      );
      const agency = this.extractAfterLabel(
        rowHtml,
        'Issued by:',
        /\bclass="[^"]*\bline-item-detail\b[^"]*"[^>]*>Issued by:\s*([\s\S]*?)<\/span>/i,
      );
      const status = this.extractText(
        rowHtml,
        /\bclass="[^"]*\btender-row-state\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
      const type = this.extractType(rowHtml);
      const openDate = this.extractText(
        rowHtml,
        /\bclass="[^"]*\bopening_date\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
      const closeDate = this.extractText(
        rowHtml,
        /\bclass="[^"]*\bclosing_date\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
      const unspsc = this.extractUnspsc(rowHtml);

      if (!rfxNumber || !title || !agency || !closeDate) {
        continue;
      }

      const detailUrl = detailHref
        ? this.absoluteUrl(detailHref)
        : `${this.origin}/tenders/open`;
      const sourceId = `${rfxNumber}-${title}`
        .replace(/\W+/g, '-')
        .toLowerCase()
        .slice(0, 80);

      candidates.push({
        source: 'vic-tenders-open',
        sourceId,
        sourceUrl: detailUrl,
        rawData: {
          rfxNumber,
          title,
          agency,
          status,
          type,
          openDate,
          closeDate,
          unspsc,
          tenderId,
          detailUrl,
          listUrl: `${this.origin}/tenders/open`,
        },
        discoveredAt: new Date().toISOString(),
      });
    }

    return candidates;
  }

  private extractText(block: string, re: RegExp): string | undefined {
    const m = re.exec(block);
    return m ? this.clean(m[1]) : undefined;
  }

  private extractAttr(block: string, re: RegExp): string | undefined {
    const m = re.exec(block);
    return m ? m[1] : undefined;
  }

  private extractAfterLabel(
    block: string,
    _label: string,
    re: RegExp,
  ): string | undefined {
    const m = re.exec(block);
    return m ? this.clean(m[1]) : undefined;
  }

  private extractType(block: string): string | undefined {
    const m =
      /\bclass="[^"]*\btender-row-state\b[^"]*"[^>]*>[\s\S]*?<\/span>\s*(?:<br\s*\/?>\s*)+([^<]+)/i.exec(
        block,
      );
    return m ? this.clean(m[1]) : undefined;
  }

  private extractUnspsc(block: string): string[] {
    const out: string[] = [];
    const re =
      /<span[^>]*\bclass="[^"]*\bline-item-detail\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const text = this.clean(m[1]);
      if (text && /\bUNSPSC\b/i.test(text)) {
        out.push(text.replace(/^UNSPSC\s*\d*\s*:\s*/i, '').trim());
      }
    }
    return out;
  }

  private clean(raw: string): string {
    return this.decodeHtmlEntities(
      raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }

  private decodeHtmlEntities(input: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
    };
    return input
      .replace(/&#[\d]+;/g, (match) =>
        String.fromCodePoint(Number.parseInt(match.slice(2, -1), 10)),
      )
      .replace(/&#x[\da-fA-F]+;/g, (match) =>
        String.fromCodePoint(
          Number.parseInt(match.slice(3, -1), 16),
        ),
      )
      .replace(/&[a-zA-Z]+;/g, (match) => entities[match] ?? match);
  }

  private absoluteUrl(path: string): string {
    if (path.startsWith('http')) return path;
    return `${this.origin}${path.startsWith('/') ? '' : '/'}${path}`;
  }
}
