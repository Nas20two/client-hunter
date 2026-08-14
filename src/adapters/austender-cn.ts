import { SourceAdapter, Candidate } from '../types.js';
import { unzipXlsx, parseSharedStrings, parseWorksheet, type CellValue } from './xlsx-manual.js';

export interface AusTenderCnAdapterConfig {
  /** Jina Reader base URL used to render the export list page as Markdown. */
  jinaBase?: string;
  /** Direct AusTender export list page (used as Referer and fallback source URL). */
  exportListUrl?: string;
  /** Optional fetch implementation for testability. */
  fetchImpl?: typeof fetch;
  /** Maximum retries for CloudFront-blocked direct downloads. */
  maxRetries?: number;
  /** Base delay in ms between retries. */
  retryBaseDelayMs?: number;
}

export interface CnCategoryCluster {
  /** Human-readable cluster name (e.g. "data-analytics"). */
  name: string;
  /** Regexes matched against Category and Description. A match includes the row. */
  include: RegExp[];
  /** Regexes matched before include; an exclude match drops the row. */
  exclude: RegExp[];
}

export interface WonContract {
  cnId: string;
  agency: string;
  value: number | null;
  category: string;
  description: string;
  procurementMethod: string;
  atmId?: string;
}

export interface CnCandidateRawData {
  roleInTender: 'supplier';
  supplierName: string;
  supplierNameCanonical: string;
  supplierAbn: string;
  supplierAbnValid: boolean;
  supplierCity: string;
  supplierPostcode: string;
  supplierCountry: string;
  categoryCluster: string;
  wonContracts: WonContract[];
  totalValue: number;
  evidenceQuote: string;
}

export const DEFAULT_CLUSTERS: CnCategoryCluster[] = [
  {
    name: 'data-analytics',
    include: [
      /\bdata\b/i,
      /\banalytics\b/i,
      /\bbusiness intelligence\b/i,
      /\bbi\b/i,
      /\bintelligence\b/i,
      /\breporting\b/i,
    ],
    exclude: [/\bcleaning\b/i, /\bcatering\b/i, /\bsecurity\b/i, /\blegal\b/i, /\btemporary personnel\b/i],
  },
  {
    name: 'software',
    include: [
      /\bsoftware\b/i,
      /\bcomputer services\b/i,
      /\bICT\b/i,
      /\bdigital\b/i,
      /\bcloud\b/i,
      /\bapplication/i,
      /\bplatform\b/i,
    ],
    exclude: [/\bcleaning\b/i, /\bcatering\b/i, /\bsecurity\b/i, /\blegal\b/i, /\btemporary personnel\b/i],
  },
  {
    name: 'consulting',
    include: [/\bconsult/i, /\badvisory\b/i, /\bprofessional services\b/i],
    exclude: [/\bcleaning\b/i, /\bcatering\b/i, /\bsecurity\b/i, /\blegal\b/i, /\btemporary personnel\b/i],
  },
  {
    name: 'infrastructure',
    include: [/\binfrastructure\b/i, /\bnetwork/i, /\bsystems integration\b/i, /\btelecommunications\b/i],
    exclude: [/\bcleaning\b/i, /\bcatering\b/i, /\bsecurity\b/i, /\blegal\b/i, /\btemporary personnel\b/i],
  },
];

const XLSX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/**
 * AusTender Contract Notice (CN) weekly export adapter.
 *
 * CN data identifies recently-awarded contracts:
 *   - Supplier name + ABN (who won)
 *   - Contract value, agency, UNSPSC category (what/where they won)
 *
 * The export list page is fetched via Jina Reader (the raw site is
 * CloudFront-blocked), then the latest .xlsx link is downloaded with
 * browser-like headers and parsed with the `xlsx` package.
 *
 * Rows are merged by supplier + category cluster so that one Candidate
 * represents one supplier win-card, not one awarded contract row.
 */
export class AusTenderCnAdapter implements SourceAdapter {
  name = 'austender-cn';
  private jinaBase: string;
  private exportListUrl: string;
  private fetchImpl: typeof fetch;
  private maxRetries: number;
  private retryBaseDelayMs: number;
  private clusters: CnCategoryCluster[];

  constructor(config: AusTenderCnAdapterConfig = {}) {
    this.jinaBase = config.jinaBase ?? 'https://r.jina.ai/http://www.tenders.gov.au';
    this.exportListUrl = config.exportListUrl ?? 'https://www.tenders.gov.au/Reports/CnWeeklyExportList';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 5000;
    this.clusters = DEFAULT_CLUSTERS;
  }

  async discover(): Promise<Candidate[]> {
    const xlsxUrl = await this.findExportLink();
    const buffer = await this.downloadXlsx(xlsxUrl);
    return this.parseWorkbook(buffer, xlsxUrl);
  }

  /**
   * Render the export list page through Jina Reader and extract the
   * first weekly export download link.
   *
   * AusTender exposes download URLs as
   * `/Reports/CnWeeklyExportDownload/{guid}` (the response is the binary
   * .xlsx with Content-Disposition). Older export lists may expose direct
   * `.xlsx` URLs; both patterns are handled.
   */
  async findExportLink(): Promise<string> {
    const jinaUrl = `${this.jinaBase}/Reports/CnWeeklyExportList`;
    const res = await this.fetchImpl(jinaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; client-hunter/0.1)',
      },
    });
    if (!res.ok) {
      throw new Error(`CN export list fetch failed: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();

    // Prefer the GUID-based weekly export download endpoint (current format).
    const guidMatch = text.match(/https?:\/\/[^\s\"<>()]*\/Reports\/CnWeeklyExportDownload\/[^\s\"<>()]+/i);
    if (guidMatch) {
      return guidMatch[0];
    }

    // Fallback for direct .xlsx links if AusTender ever changes the list page.
    const directMatch = text.match(/https?:\/\/[^\s\"<>()]+\.xlsx/i);
    if (directMatch) {
      return directMatch[0];
    }

    throw new Error('Could not find a Contract Notice weekly export download link in the Jina-rendered list.');
  }

  /**
   * Download the binary .xlsx from tenders.gov.au using browser-like headers.
   * CloudFront rejects requests that lack Accept + Referer, so we retry with
   * exponential backoff and validate the magic bytes before returning.
   */
  async downloadXlsx(url: string): Promise<ArrayBuffer> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, {
          headers: {
            Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
            Referer: this.exportListUrl,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept-Language': 'en-AU,en;q=0.9',
          },
        });
        if (!res.ok) {
          throw new Error(`CN XLSX download failed: ${res.status} ${res.statusText} (${url})`);
        }
        const buffer = await res.arrayBuffer();
        validateXlsxMagicBytes(buffer);
        return buffer;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryBaseDelayMs * 2 ** attempt;
          await sleep(delay);
        }
      }
    }
    throw lastError ?? new Error(`CN XLSX download failed after ${this.maxRetries} attempts (${url})`);
  }

  /**
   * Parse the workbook and map each row to a Candidate. Empty rows and
   * rows missing an Agency or Supplier Name are skipped.
   *
   * The AusTender CN export has a variable-length preamble (typically 2-3
   * rows) before the real column headers. Instead of hard-coding the header
   * row, we scan the worksheet for the first row containing the required
   * column names and use it as the header.
   */
  parseWorkbook(buffer: ArrayBuffer, sourceUrl: string): Candidate[] {
    const files = unzipXlsx(buffer);

    const worksheetXml = files.get('xl/worksheets/sheet1.xml');
    if (!worksheetXml) {
      throw new Error('CN export workbook is missing xl/worksheets/sheet1.xml');
    }

    const sharedStringsXml = files.get('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml.toString('utf8')) : [];
    const allRows = parseWorksheet(worksheetXml.toString('utf8'), sharedStrings);

    const headerIndex = findHeaderRow(allRows, ['CN ID', 'Supplier Name', 'Agency', 'Category', 'Value']);
    if (headerIndex === -1) {
      throw new Error('CN export missing required columns; could not locate header row.');
    }

    const headers = allRows[headerIndex].map((h) => stringValue(h));
    const dataRows = allRows.slice(headerIndex + 1);

    // Merge rows by supplier identity + category cluster.
    const mergeMap = new Map<string, MutableCnSupplierRecord>();

    for (const cells of dataRows) {
      const record = this.parseRow(headers, cells);
      if (!record) continue;

      const key = `${record.supplierKey}::${record.categoryCluster}`;
      const existing = mergeMap.get(key);
      if (existing) {
        existing.wonContracts.push(record.wonContract);
        existing.totalValue += record.wonContract.value ?? 0;
      } else {
        mergeMap.set(key, {
          supplierName: record.supplierName,
          supplierNameCanonical: record.supplierNameCanonical,
          supplierAbn: record.supplierAbn,
          supplierAbnValid: record.supplierAbnValid,
          supplierCity: record.supplierCity,
          supplierPostcode: record.supplierPostcode,
          supplierCountry: record.supplierCountry,
          categoryCluster: record.categoryCluster,
          wonContracts: [record.wonContract],
          totalValue: record.wonContract.value ?? 0,
        });
      }
    }

    const candidates: Candidate[] = [];
    for (const record of mergeMap.values()) {
      const sourceId = record.supplierAbnValid
        ? `cn-abn-${record.supplierAbn}-${record.categoryCluster}`
        : `cn-supplier-${record.supplierNameCanonical.slice(0, 30)}-${record.supplierPostcode}-${record.categoryCluster}`;

      candidates.push({
        source: this.name,
        sourceId: sourceId.replace(/\W+/g, '-').toLowerCase(),
        sourceUrl,
        rawData: {
          roleInTender: 'supplier',
          supplierName: record.supplierName,
          supplierNameCanonical: record.supplierNameCanonical,
          supplierAbn: record.supplierAbn,
          supplierAbnValid: record.supplierAbnValid,
          supplierCity: record.supplierCity,
          supplierPostcode: record.supplierPostcode,
          supplierCountry: record.supplierCountry,
          categoryCluster: record.categoryCluster,
          wonContracts: record.wonContracts,
          totalValue: record.totalValue,
          evidenceQuote: buildEvidenceQuote(record),
        } satisfies CnCandidateRawData,
        discoveredAt: new Date().toISOString(),
      });
    }

    return candidates;
  }

  private parseRow(headers: string[], cells: CellValue[]): ParsedRow | null {
    const get = (name: string): string => {
      const index = headers.indexOf(name);
      return index >= 0 ? stringValue(cells[index]) : '';
    };

    const agency = get('Agency');
    const supplierName = get('Supplier Name');
    const cnId = get('CN ID');
    if (!agency || !supplierName || !cnId) {
      return null;
    }

    const supplierCountry = get('Supplier Country');
    if (supplierCountry && !/^(AU|AUSTRALIA)$/i.test(supplierCountry)) {
      return null;
    }

    const supplierNameCanonical = canonicalizeSupplierName(supplierName);
    const supplierAbn = validateAbn(get('Supplier ABN'));
    const supplierPostcode = get('Supplier Postcode');
    const supplierKey = supplierAbn
      ? `abn-${supplierAbn}`
      : `${supplierNameCanonical}-${supplierPostcode || 'unknown'}`;

    const category = get('Category');
    const description = get('Description');
    const categoryCluster = determineCategoryCluster(category, description, this.clusters);
    if (categoryCluster === null) {
      return null;
    }

    const value = parseCurrency(get('Value'));
    if (value === null || value <= 0) {
      return null;
    }

    return {
      supplierKey,
      supplierName,
      supplierNameCanonical,
      supplierAbn,
      supplierAbnValid: Boolean(supplierAbn),
      supplierCity: get('Supplier City'),
      supplierPostcode,
      supplierCountry,
      categoryCluster,
      wonContract: {
        cnId,
        agency,
        value,
        category,
        description,
        procurementMethod: get('Procurement Method'),
        atmId: get('ATM ID') || undefined,
      },
    };
  }
}

interface MutableCnSupplierRecord {
  supplierName: string;
  supplierNameCanonical: string;
  supplierAbn: string;
  supplierAbnValid: boolean;
  supplierCity: string;
  supplierPostcode: string;
  supplierCountry: string;
  categoryCluster: string;
  wonContracts: WonContract[];
  totalValue: number;
}

interface ParsedRow {
  supplierKey: string;
  supplierName: string;
  supplierNameCanonical: string;
  supplierAbn: string;
  supplierAbnValid: boolean;
  supplierCity: string;
  supplierPostcode: string;
  supplierCountry: string;
  categoryCluster: string;
  wonContract: WonContract;
}

export function validateAbn(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return /^\d{11}$/.test(digits) ? digits : '';
}

export function canonicalizeSupplierName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bPTY\s*LTD\b/gi, '')
    .replace(/\bLIMITED\b/gi, '')
    .replace(/\bLTD\b/gi, '')
    .replace(/\bAUSTRALIA\b/gi, '')
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

export function determineCategoryCluster(
  category: string,
  description: string,
  clusters: CnCategoryCluster[]
): string | null {
  const haystack = `${category} ${description}`;
  for (const cluster of clusters) {
    for (const exclude of cluster.exclude) {
      if (exclude.test(haystack)) {
        return null;
      }
    }
    for (const include of cluster.include) {
      if (include.test(haystack)) return cluster.name;
    }
  }
  return 'uncategorized';
}

export function parseCurrency(raw: string): number | null {
  if (!raw) return null;

  // Handle explicit ranges by taking the upper bound: "500K - 1M", "$100,000 - $200,000".
  const rangeMatch = raw.match(/[-–]\s*\$?([\d,.]+\s*[kKmM]?)/);
  if (rangeMatch) {
    return parseSingleCurrency(rangeMatch[1]);
  }

  return parseSingleCurrency(raw);
}

function parseSingleCurrency(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.kKmM]/g, '').trim().toLowerCase();
  if (!cleaned) return null;

  const multiplier = cleaned.endsWith('k') ? 1_000 : cleaned.endsWith('m') ? 1_000_000 : 1;
  const numeric = cleaned.replace(/[kKmM]/g, '');
  const value = parseFloat(numeric);
  if (Number.isNaN(value)) return null;
  return value * multiplier;
}

function buildEvidenceQuote(record: MutableCnSupplierRecord): string {
  const contractCount = record.wonContracts.length;
  const first = record.wonContracts[0];
  const valueText = record.totalValue > 0 ? ` $${record.totalValue.toLocaleString()}` : '';
  const plural = contractCount > 1 ? `s (${contractCount} contracts)` : '';
  return `AusTender Contract Notice${plural}: ${record.supplierName} won${valueText} in ${record.categoryCluster.replace(/-/g, ' ')}. Example: ${first.agency} — ${first.description} (${first.cnId}).`;
}

function findHeaderRow(rows: CellValue[][], required: string[]): number {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => stringValue(c));
    if (required.every((col) => cells.includes(col))) {
      return i;
    }
  }
  return -1;
}

function validateXlsxMagicBytes(buffer: ArrayBuffer): void {
  if (buffer.byteLength < XLSX_MAGIC.length) {
    throw new Error('CN download too small to be a valid XLSX');
  }
  const header = new Uint8Array(buffer.slice(0, XLSX_MAGIC.length));
  for (let i = 0; i < XLSX_MAGIC.length; i += 1) {
    if (header[i] !== XLSX_MAGIC[i]) {
      throw new Error('CN download blocked: received non-XLSX content (likely CloudFront HTML)');
    }
  }
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
