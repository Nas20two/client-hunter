import { test } from 'node:test';
import assert from 'node:assert';
import { buildXlsxBuffer } from '../xlsx-manual.js';
import {
  AusTenderCnAdapter,
  validateAbn,
  canonicalizeSupplierName,
  parseCurrency,
  determineCategoryCluster,
  DEFAULT_CLUSTERS,
  type CnCandidateRawData,
} from '../austender-cn.js';

function makeMockFetch(responses: { url: RegExp; response: Response }[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const { url: pattern, response } of responses) {
      if (pattern.test(url)) return response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function buildXlsxBufferWithBadHeaders(): ArrayBuffer {
  return buildXlsxBuffer([
    { Wrong: 'x', Headers: 'y' },
  ]);
}

const BASE_ROW = {
  Agency: 'Department of Education',
  'Parent CN ID': '',
  'CN ID': 'CN4266352',
  'Publish Date': '',
  'Amendment Publish Date': '',
  Status: 'published',
  'Start Date': '',
  'End Date': '',
  Value: 756800,
  Description: 'Data and Analytics services for the CCS Regulatory Data Sharing Project.',
  'Agency Ref. ID': '',
  Category: 'Computer services',
  'Procurement Method': 'Open tender',
  'ATM ID': 'DTA-ICT-50582',
  'SON ID': '',
  'Confidentiality - Contract': 'No',
  'Confidentiality - Contract Reason(s)': '',
  'Confidentiality - Outputs': 'No',
  'Confidentiality - Outputs Reason(s)': '',
  Consultancy: 'No',
  'Consultancy Reason(s)': '',
  'Amendment Reason': '',
  'Supplier Name': 'ALTIS CONSULTING PTY LTD',
  'Supplier City': 'Sydney',
  'Supplier Postcode': '2000',
  'Supplier Country': 'AUSTRALIA',
  'Supplier ABNExempt': 'No',
  'Supplier ABN': '12345678901',
  'Agency Branch': '',
  'Agency Divison': '',
  'Agency Postcode': '',
};

test('findExportLink extracts a GUID-based weekly export download URL', async () => {
  const text = `[02-Aug-26 to 08-Aug-26](http://www.tenders.gov.au/Reports/CnWeeklyExportDownload/7fffbb4e-c549-4896-9c52-7e3662cdf12c)\n[26-Jul-26 to 01-Aug-26](http://www.tenders.gov.au/Reports/CnWeeklyExportDownload/7d470e43-6f55-49c7-9ea7-a59a09aab522)`;
  const fetchImpl = makeMockFetch([
    {
      url: /Reports\/CnWeeklyExportList$/,
      response: new Response(text, { status: 200 }),
    },
  ]);
  const adapter = new AusTenderCnAdapter({ fetchImpl });
  const link = await adapter.findExportLink();
  assert.strictEqual(link, 'http://www.tenders.gov.au/Reports/CnWeeklyExportDownload/7fffbb4e-c549-4896-9c52-7e3662cdf12c');
});

test('findExportLink extracts a direct .xlsx URL from Jina markdown', async () => {
  const text = 'Weekly Contract Notice Export\n\nhttps://www.tenders.gov.au/Reports/AusTender-Contract-Notice-Export_20260814_001409.xlsx\n\nDownload';
  const fetchImpl = makeMockFetch([
    {
      url: /Reports\/CnWeeklyExportList$/,
      response: new Response(text, { status: 200 }),
    },
  ]);
  const adapter = new AusTenderCnAdapter({ fetchImpl });
  const link = await adapter.findExportLink();
  assert.strictEqual(link, 'https://www.tenders.gov.au/Reports/AusTender-Contract-Notice-Export_20260814_001409.xlsx');
});

test('findExportLink throws when no export link is found', async () => {
  const fetchImpl = makeMockFetch([
    {
      url: /Reports\/CnWeeklyExportList$/,
      response: new Response('No export links today.', { status: 200 }),
    },
  ]);
  const adapter = new AusTenderCnAdapter({ fetchImpl });
  await assert.rejects(adapter.findExportLink(), /Could not find a Contract Notice weekly export download link/);
});

test('parseWorkbook maps awarded-contract rows to supplier candidates', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW },
    {
      ...BASE_ROW,
      Agency: 'Department of Health',
      'CN ID': 'CN1234567',
      Description: 'Digital transformation advisory services',
      Category: 'Consulting services',
      Value: 120000,
      'Supplier Name': 'ACME CONSULTING PTY LTD',
      'Supplier ABN': '98765432109',
    },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  assert.strictEqual(candidates.length, 2);
  const first = candidates.find((c) => c.rawData.supplierName === 'ALTIS CONSULTING PTY LTD')!;
  const firstRaw = first.rawData as unknown as CnCandidateRawData;
  assert.strictEqual(first.source, 'austender-cn');
  assert.ok(first.sourceId.includes('cn-abn-12345678901'));
  assert.strictEqual(firstRaw.supplierNameCanonical, canonicalizeSupplierName('ALTIS CONSULTING PTY LTD'));
  assert.strictEqual(firstRaw.categoryCluster, 'data-analytics');
  assert.strictEqual(firstRaw.wonContracts.length, 1);
  assert.strictEqual(firstRaw.wonContracts[0].cnId, 'CN4266352');
  assert.strictEqual(firstRaw.totalValue, 756800);
  assert.ok(firstRaw.evidenceQuote.includes('CN4266352'));
});

test('parseWorkbook merges multiple wins for the same supplier in the same category cluster', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW, 'CN ID': 'CN4266352', Value: 756800, Description: 'Data and Analytics services A' },
    {
      ...BASE_ROW,
      'CN ID': 'CN4266353',
      Value: 250000,
      Description: 'Data and Analytics services B',
      'Agency Ref. ID': 'REF-2',
    },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  assert.strictEqual(candidates.length, 1);
  const mergedRaw = candidates[0].rawData as unknown as CnCandidateRawData;
  assert.strictEqual(mergedRaw.wonContracts.length, 2);
  assert.strictEqual(mergedRaw.totalValue, 1_006_800);
});

test('parseWorkbook splits same supplier across unrelated category clusters', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW, 'CN ID': 'CN1', Category: 'Computer services', Description: 'Data platform' },
    {
      ...BASE_ROW,
      'CN ID': 'CN2',
      Category: 'Legal services',
      Description: 'Legal advisory',
      Value: 50000,
      'Agency Ref. ID': 'REF-2',
    },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  // Legal services is excluded by all clusters, so only the data-analytics card remains.
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].rawData.categoryCluster, 'data-analytics');
});

test('parseWorkbook falls back to name+postcode key when ABN is missing', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW, 'Supplier ABN': '' },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].rawData.supplierAbnValid, false);
  assert.ok(candidates[0].sourceId.includes('cn-supplier-'));
});

test('parseWorkbook skips non-AU suppliers', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW, 'Supplier Country': 'NZ' },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  assert.strictEqual(candidates.length, 0);
});

test('parseWorkbook skips rows with zero or unparseable value', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW, Value: 0 },
    { ...BASE_ROW, Value: 'N/A', 'CN ID': 'CN2' },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  assert.strictEqual(candidates.length, 0);
});

test('parseWorkbook infers category cluster from Description when Category is blank', () => {
  const buffer = buildXlsxBuffer([
    { ...BASE_ROW, Category: '', Description: 'Cloud migration and data analytics platform' },
  ]);

  const adapter = new AusTenderCnAdapter();
  const candidates = adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx');

  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].rawData.categoryCluster, 'data-analytics');
});

test('parseWorkbook throws when required columns are missing', () => {
  const buffer = buildXlsxBufferWithBadHeaders();

  const adapter = new AusTenderCnAdapter();
  assert.throws(() => adapter.parseWorkbook(buffer, 'https://example.com/export.xlsx'), /could not locate header row/);
});

test('discover orchestrates list fetch, download, and parse', async () => {
  const xlsxBuffer = buildXlsxBuffer([{ ...BASE_ROW }]);

  const fetchImpl = makeMockFetch([
    {
      url: /Reports\/CnWeeklyExportList$/,
      response: new Response(
        '[02-Aug-26 to 08-Aug-26](http://www.tenders.gov.au/Reports/CnWeeklyExportDownload/7fffbb4e-c549-4896-9c52-7e3662cdf12c)',
        { status: 200 }
      ),
    },
    {
      url: /Reports\/CnWeeklyExportDownload\/7fffbb4e-c549-4896-9c52-7e3662cdf12c$/,
      response: new Response(xlsxBuffer, { status: 200 }),
    },
  ]);

  const adapter = new AusTenderCnAdapter({ fetchImpl });
  const candidates = await adapter.discover();

  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].source, 'austender-cn');
  assert.strictEqual(candidates[0].rawData.supplierName, 'ALTIS CONSULTING PTY LTD');
});

test('downloadXlsx throws on non-OK response', async () => {
  const fetchImpl = makeMockFetch([
    {
      url: /\.xlsx$/,
      response: new Response('Forbidden', { status: 403 }),
    },
  ]);
  const adapter = new AusTenderCnAdapter({ fetchImpl, maxRetries: 1 });
  await assert.rejects(adapter.downloadXlsx('https://www.tenders.gov.au/export.xlsx'), /CN XLSX download failed: 403/);
});

test('downloadXlsx throws when response is HTML instead of XLSX', async () => {
  const fetchImpl = makeMockFetch([
    {
      url: /download$/,
      response: new Response('<html>CloudFront blocked</html>', { status: 200 }),
    },
  ]);
  const adapter = new AusTenderCnAdapter({ fetchImpl, maxRetries: 1 });
  await assert.rejects(
    adapter.downloadXlsx('https://www.tenders.gov.au/download'),
    /CN download blocked: received non-XLSX content/
  );
});

test('validateAbn accepts 11-digit ABNs and rejects invalid values', () => {
  assert.strictEqual(validateAbn('12 345 678 901'), '12345678901');
  assert.strictEqual(validateAbn('12345678901'), '12345678901');
  assert.strictEqual(validateAbn('N/A'), '');
  assert.strictEqual(validateAbn('123'), '');
});

test('canonicalizeSupplierName strips legal suffixes and normalizes case', () => {
  assert.strictEqual(canonicalizeSupplierName('ALTIS CONSULTING PTY LTD'), 'ALTISCONSULTING');
  assert.strictEqual(canonicalizeSupplierName('Acme Staffing Limited'), 'ACMESTAFFING');
});

test('parseCurrency handles numbers, commas, ranges and suffixes', () => {
  assert.strictEqual(parseCurrency('756800'), 756800);
  assert.strictEqual(parseCurrency('$756,800'), 756800);
  assert.strictEqual(parseCurrency('1.2M'), 1_200_000);
  assert.strictEqual(parseCurrency('$500K - $1M'), 1_000_000);
  assert.strictEqual(parseCurrency('N/A'), null);
});

test('determineCategoryCluster maps categories and descriptions to clusters', () => {
  assert.strictEqual(determineCategoryCluster('Computer services', '', DEFAULT_CLUSTERS), 'software');
  assert.strictEqual(determineCategoryCluster('', 'Data analytics platform', DEFAULT_CLUSTERS), 'data-analytics');
  assert.strictEqual(determineCategoryCluster('Cleaning services', '', DEFAULT_CLUSTERS), null);
});
