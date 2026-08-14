import { test } from 'node:test';
import assert from 'node:assert';
import { deflateRawSync } from 'node:zlib';
import {
  unzipXlsx,
  parseSharedStrings,
  parseWorksheet,
  buildXlsxBuffer,
  type CellValue,
} from '../xlsx-manual.js';

// ---------------------------------------------------------------------------
// Helpers: build raw ZIP buffers for stress-testing unzipXlsx in isolation.
// ---------------------------------------------------------------------------

function makeZipLocalHeader(name: string, compressedSize: number, uncompressedSize: number, method = 8): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(method, 8); // compression method
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(0, 14); // CRC-32
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([header, nameBuf]);
}

function buildRawZip(entries: { name: string; data: string; method?: number }[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const dataBuf = Buffer.from(entry.data, 'utf8');
    const compressed = entry.method === 0 ? dataBuf : deflateRawSync(dataBuf);
    parts.push(makeZipLocalHeader(entry.name, compressed.length, dataBuf.length, entry.method ?? 8));
    parts.push(compressed);
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// unzipXlsx stress tests
// ---------------------------------------------------------------------------

test('unzipXlsx returns empty Map for empty buffer', () => {
  const result = unzipXlsx(new ArrayBuffer(0));
  assert.strictEqual(result.size, 0);
});

test('unzipXlsx returns empty Map for HTML content', () => {
  const html = Buffer.from('<html><head></head><body>Forbidden</body></html>');
  const result = unzipXlsx(html);
  assert.strictEqual(result.size, 0);
});

test('unzipXlsx throws on truncated local file header', () => {
  const zip = buildRawZip([{ name: 'test.txt', data: 'hello world' }]);
  const truncated = zip.subarray(0, 20); // cuts through the local header
  assert.throws(() => unzipXlsx(truncated), /Truncated XLSX local file header/);
});

test('unzipXlsx throws on truncated file data', () => {
  const header = makeZipLocalHeader('test.txt', 100, 100);
  const zip = Buffer.concat([header, Buffer.from('short')]);
  assert.throws(() => unzipXlsx(zip), /Truncated XLSX file data/);
});

test('unzipXlsx throws on unsupported compression method', () => {
  const dataBuf = Buffer.from('irrelevant', 'utf8');
  const header = makeZipLocalHeader('test.txt', dataBuf.length, dataBuf.length, 99);
  const zip = Buffer.concat([header, dataBuf]);
  assert.throws(() => unzipXlsx(zip), /Unsupported XLSX compression method: 99/);
});

test('unzipXlsx handles stored (uncompressed) entries', () => {
  const dataBuf = Buffer.from('stored-plaintext', 'utf8');
  const header = makeZipLocalHeader('plain.txt', dataBuf.length, dataBuf.length, 0);
  const zip = Buffer.concat([header, dataBuf]);
  const files = unzipXlsx(zip);
  assert.strictEqual(files.get('plain.txt')?.toString('utf8'), 'stored-plaintext');
});

test('unzipXlsx extracts multiple files', () => {
  const xmlA = '<root><child>A</child></root>';
  const xmlB = '<root><child>B</child></root>';
  const zip = buildRawZip([
    { name: 'a.xml', data: xmlA },
    { name: 'b.xml', data: xmlB },
  ]);
  const files = unzipXlsx(zip);
  assert.strictEqual(files.size, 2);
  assert.strictEqual(files.get('a.xml')?.toString('utf8'), xmlA);
  assert.strictEqual(files.get('b.xml')?.toString('utf8'), xmlB);
});

// ---------------------------------------------------------------------------
// parseSharedStrings stress tests
// ---------------------------------------------------------------------------

test('parseSharedStrings returns empty array for empty XML', () => {
  const result = parseSharedStrings('');
  assert.deepStrictEqual(result, []);
});

test('parseSharedStrings handles simple strings', () => {
  const xml = `
    <sst>
      <si><t>CN ID</t></si>
      <si><t>Agency</t></si>
      <si><t>Supplier Name</t></si>
    </sst>
  `;
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, ['CN ID', 'Agency', 'Supplier Name']);
});

test('parseSharedStrings decodes XML entities', () => {
  const xml = '<sst><si><t>AT&amp;T Consulting &lt;Corp&gt;</t></si></sst>';
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, ['AT&T Consulting <Corp>']);
});

test('parseSharedStrings handles numeric character references', () => {
  const xml = '<sst><si><t>&#36;&#163;&#x20AC;</t></si></sst>';
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, ['$£€']);
});

test('parseSharedStrings handles rich text with multiple <t> runs', () => {
  const xml = `
    <sst>
      <si>
        <r><t>Hello </t></r>
        <r><t>World</t></r>
      </si>
    </sst>
  `;
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, ['Hello World']);
});

test('parseSharedStrings preserves unicode content', () => {
  const xml = '<sst><si><t>日本語テキスト</t></si><si><t>Emoji ✅</t></si></sst>';
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, ['日本語テキスト', 'Emoji ✅']);
});

test('parseSharedStrings produces empty string for blank entries', () => {
  const xml = '<sst><si></si><si><t/></si></sst>';
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, ['', '']);
});

// ---------------------------------------------------------------------------
// parseWorksheet stress tests
// ---------------------------------------------------------------------------

test('parseWorksheet returns empty array for empty sheetData', () => {
  const xml = '<?xml version="1.0"?><worksheet><sheetData></sheetData></worksheet>';
  const result = parseWorksheet(xml, []);
  assert.deepStrictEqual(result, []);
});

test('parseWorksheet fills sparse rows and columns with empty string', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="C1"><v>42</v></c>
        </row>
        <row r="3">
          <c r="B3" t="s"><v>1</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, ['First', 'Second']);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result[0], ['First', '', 42]); // row 1
  assert.deepStrictEqual(result[1], ['', '', '']); // row 2 (blank)
  assert.deepStrictEqual(result[2], ['', 'Second', '']); // row 3
});

test('parseWorksheet returns empty string for out-of-bounds shared string index', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>99</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, ['OnlyOne']);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0], ['']);
});

test('parseWorksheet maps cell references beyond column Z', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="Z1"><v>25</v></c>
          <c r="AA1"><v>26</v></c>
          <c r="AB1"><v>27</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, []);
  assert.strictEqual(result.length, 1);
  const row = result[0];
  assert.strictEqual(row.length, 28); // 0..27
  assert.strictEqual(row[25], 25);
  assert.strictEqual(row[26], 26);
  assert.strictEqual(row[27], 27);
});

test('parseWorksheet handles boolean cells', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="b"><v>1</v></c>
          <c r="B1" t="b"><v>0</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, []);
  assert.deepStrictEqual(result[0], [true, false]);
});

test('parseWorksheet handles inline strings', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="inlineStr"><is><t>Inline Hello</t></is></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, []);
  assert.deepStrictEqual(result[0], ['Inline Hello']);
});

test('parseWorksheet returns empty string for cells with no <v> tag', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="s"/>
          <c r="B1"><v></v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, []);
  assert.deepStrictEqual(result[0], ['', '']);
});

test('parseWorksheet handles numeric and string mix', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1"><v>123.45</v></c>
          <c r="B1" t="s"><v>0</v></c>
          <c r="C1"><v>-7</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, ['Text']);
  assert.deepStrictEqual(result[0], [123.45, 'Text', -7]);
});

test('parseWorksheet handles xml:space="preserve"', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, ['  spaced  ']);
  assert.strictEqual(result[0][0], '  spaced  ');
});

// ---------------------------------------------------------------------------
// Integration: buildXlsxBuffer round-trip
// ---------------------------------------------------------------------------

test('buildXlsxBuffer creates a parseable XLSX from row objects', () => {
  const buffer = buildXlsxBuffer([
    { Name: 'Alice', Age: 30, City: 'Sydney' },
    { Name: 'Bob', Age: 25, City: 'Melbourne' },
  ]);
  const files = unzipXlsx(buffer);
  assert.ok(files.has('xl/worksheets/sheet1.xml'));
  assert.ok(files.has('xl/sharedStrings.xml'));
});

test('end-to-end round-trip: rows survive unzip -> parse -> reassemble', () => {
  const rows = [
    { 'CN ID': 'CN1001', Agency: 'Dept A', 'Supplier Name': 'Acme Pty Ltd', Value: 50000, Category: 'Software' },
    { 'CN ID': 'CN1002', Agency: 'Dept B', 'Supplier Name': 'Beta Limited', Value: 120000, Category: 'Consulting' },
  ];
  const buffer = buildXlsxBuffer(rows);
  const files = unzipXlsx(buffer);
  const worksheetXml = files.get('xl/worksheets/sheet1.xml')!.toString('utf8');
  const sharedStringsXml = files.get('xl/sharedStrings.xml')!.toString('utf8');
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const parsed = parseWorksheet(worksheetXml, sharedStrings);

  // The builder adds 2 preamble rows before the header, then the data.
  // 0: ['Contract Notice Export', '', '', '', '', '']
  // 1: ['', '', '', '', '', '']
  // 2: ['CN ID', 'Agency', 'Supplier Name', 'Value', 'Category']
  // 3+: data rows
  assert.strictEqual(parsed.length, 5);
  const headers = parsed[2];
  assert.strictEqual(headers[0], 'CN ID');
  const dataRow = parsed[3];
  assert.strictEqual(dataRow[0], 'CN1001');
  assert.strictEqual(dataRow[1], 'Dept A');
  assert.strictEqual(dataRow[2], 'Acme Pty Ltd');
  assert.strictEqual(dataRow[3], 50000);
  assert.strictEqual(dataRow[4], 'Software');
});

test('end-to-end: missing sharedStrings.xml when strings referenced returns empty strings', () => {
  // Manually build a ZIP with worksheet referencing shared strings but no sharedStrings.xml
  const worksheetXml = `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c></row>
      </sheetData>
    </worksheet>
  `;
  const zip = buildRawZip([
    { name: 'xl/worksheets/sheet1.xml', data: worksheetXml },
  ]);
  const files = unzipXlsx(zip);
  const sheet = parseWorksheet(files.get('xl/worksheets/sheet1.xml')!.toString('utf8'), []);
  assert.deepStrictEqual(sheet[0], ['']);
});

test('end-to-end: missing sheet1.xml throws at adapter level', () => {
  const zip = buildRawZip([
    { name: 'xl/sharedStrings.xml', data: '<sst/>' },
  ]);
  const files = unzipXlsx(zip);
  assert.strictEqual(files.has('xl/worksheets/sheet1.xml'), false);
});

test('end-to-end: malformed worksheet XML returns empty rows', () => {
  // Unclosed <row> tag: matchAll won't find it, so rows should be empty.
  const badXml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1"><v>42</v></c>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(badXml, []);
  assert.deepStrictEqual(result, []);
});

test('end-to-end: truncated ZIP mid-file throws meaningful error', () => {
  const bigData = 'x'.repeat(1000);
  const zip = buildRawZip([{ name: 'data.txt', data: bigData }]);
  const truncated = zip.subarray(0, Math.floor(zip.length / 2));
  assert.throws(
    () => unzipXlsx(truncated),
    /Truncated/
  );
});

test('end-to-end: empty row objects build valid XLSX', () => {
  const buffer = buildXlsxBuffer([]);
  const files = unzipXlsx(buffer);
  const worksheetXml = files.get('xl/worksheets/sheet1.xml')!.toString('utf8');
  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8'));
  const parsed = parseWorksheet(worksheetXml, sharedStrings);
  // Two preamble rows plus empty header row.
  assert.strictEqual(parsed.length, 3);
});

test('end-to-end: unicode values survive round-trip', () => {
  const rows = [{ Emoji: '✅', Japanese: '日本語', Euro: '€50' }];
  const buffer = buildXlsxBuffer(rows);
  const files = unzipXlsx(buffer);
  const worksheetXml = files.get('xl/worksheets/sheet1.xml')!.toString('utf8');
  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8'));
  const parsed = parseWorksheet(worksheetXml, sharedStrings);
  const dataRow = parsed[3]; // preamble(2) + header(1) + data start
  assert.strictEqual(dataRow[0], '✅');
  assert.strictEqual(dataRow[1], '日本語');
  assert.strictEqual(dataRow[2], '€50');
});

test('parseWorksheet handles very sparse data with many empty rows', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1"><c r="A1"><v>1</v></c></row>
        <row r="100"><c r="Z100" t="s"><v>0</v></c></row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, ['Last']);
  assert.strictEqual(result.length, 100);
  assert.strictEqual(result[0][0], 1);
  // Rows 2-99 should be filled with empty strings
  for (let i = 1; i < 98; i++) {
    assert.deepStrictEqual(result[i], Array(26).fill(''));
  }
  // Row 100 should have 'Last' in col 25 (Z)
  assert.strictEqual(result[99][25], 'Last');
});

test('parseWorksheet handles <c> with attributes containing extra whitespace', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1"  t="s" ><v>0</v></c>
          <c r="B1" ><v>99</v></c>
        </row>
      </sheetData>
    </worksheet>
  `;
  const result = parseWorksheet(xml, ['Hello']);
  assert.deepStrictEqual(result[0], ['Hello', 99]);
});

test('parseSharedStrings handles <t> with xml:space="preserve" attribute', () => {
  const xml = '<sst><si><t xml:space="preserve"> spaced </t></si></sst>';
  const result = parseSharedStrings(xml);
  assert.deepStrictEqual(result, [' spaced ']);
});

test('unzipXlsx ignores trailing non-header bytes after valid local entries', () => {
  const zip = buildRawZip([{ name: 'file.txt', data: 'content' }]);
  const garbage = Buffer.concat([zip, Buffer.from('not-a-header-trailing-garbage')]);
  const files = unzipXlsx(garbage);
  assert.strictEqual(files.size, 1);
  assert.strictEqual(files.get('file.txt')?.toString('utf8'), 'content');
});
