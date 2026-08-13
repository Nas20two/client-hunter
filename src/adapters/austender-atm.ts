import { SourceAdapter, Candidate } from '../types.js';

/**
 * AusTender /atm adapter (Phase 1 primary source).
 *
 * The raw `/atm` page is CloudFront-blocked for direct clients, but
 * Jina Reader can render its Markdown. ATM IDs and URLs are not always
 * present in the rendered markdown, so this adapter returns candidates
 * keyed by title + agency + close date for downstream verification.
 */
export class AusTenderAtmAdapter implements SourceAdapter {
  name = 'ausTenderAtm';
  private jinaBase: string;

  constructor(jinaBase = 'https://r.jina.ai/http://www.tenders.gov.au') {
    this.jinaBase = jinaBase;
  }

  async discover(): Promise<Candidate[]> {
    const url = `${this.jinaBase}/atm`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; client-hunter/0.1)',
      },
    });
    if (!res.ok) {
      throw new Error(`AusTender /atm Jina fetch failed: ${res.status}`);
    }
    const text = await res.text();
    return this.parseAtmList(text, url);
  }

  parseAtmList(text: string, listUrl: string): Candidate[] {
    const lines = text.split('\n');
    const candidates: Candidate[] = [];

    // Each record is delimited by a title line followed by key:value pairs and a
    // '**Last Updated:**' marker. We accumulate fields per record and flush on each
    // Last Updated line or EOF.
    const recordDelimiters = new Set(['**Last Updated']);
    const metaPrefixes = [
      '#',
      '*',
      'Title:',
      'URL Source:',
      'Markdown Content:',
      'To access this element',
      'An Approach to Market',
      'You can search or view',
      '[',
    ];
    const metaExact = new Set(['Search Results', 'Current ATM List']);

    let currentTitle: string | null = null;
    const fields: Record<string, string> = {};
    let currentKey: string | null = null;
    let recordHasAgency = false;

    const isMeta = (line: string): boolean => {
      if (line.startsWith('**Last Updated')) return false;
      if (metaExact.has(line)) return true;
      for (const prefix of metaPrefixes) {
        if (line.startsWith(prefix)) return true;
      }
      return false;
    };

    const flushRecord = (): void => {
      if (currentTitle && recordHasAgency) {
        const sourceId = `${fields.Agency.slice(0, 20)}-${fields['Close Date & Time'] ?? 'unknown'}-${currentTitle.slice(0, 30)}`;
        candidates.push({
          source: 'austender-atm',
          sourceId: sourceId.replace(/\W+/g, '-').toLowerCase(),
          sourceUrl: listUrl,
          rawData: {
            title: currentTitle,
            agency: fields.Agency,
            category: fields.Category,
            description: fields.Description,
            closeDate: fields['Close Date & Time'],
            lastUpdated: fields.lastUpdated,
          },
          discoveredAt: new Date().toISOString(),
        });
      }
    };

    const resetRecord = (): void => {
      currentTitle = null;
      recordHasAgency = false;
      currentKey = null;
      Object.keys(fields).forEach((k) => delete fields[k]);
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (isMeta(line)) continue;

      if (line.startsWith('**Last Updated')) {
        const lastUpdated = line.replace(/^\*\*Last Updated:\*\*/i, '').trim();
        if (lastUpdated) {
          fields.lastUpdated = lastUpdated;
        }
        flushRecord();
        resetRecord();
        continue;
      }

      if (line.endsWith(':')) {
        currentKey = line.slice(0, -1).trim();
        continue;
      }

      if (currentKey) {
        const key = this.fieldKey(currentKey);
        fields[key] = line;
        if (key === 'Agency') {
          recordHasAgency = true;
        }
        currentKey = null;
        continue;
      }

      if (!currentTitle) {
        currentTitle = line;
      }
    }

    flushRecord();
    return candidates;
  }

  private fieldKey(label: string): string {
    return label.replace(/\s+/g, ' ').trim();
  }
}
