import { inflateRawSync, deflateRawSync } from 'zlib';

export type CellValue = string | number | boolean | null;

export interface ParsedWorksheet {
  sheetName: string;
  rows: CellValue[][];
}

/**
 * Minimal ZIP reader sufficient for .xlsx files.
 *
 * Scans local file headers (signature 0x04034b50). This intentionally avoids
 * introducing a third-party ZIP dependency while handling the structure
 * produced by Excel, LibreOffice, and our minimal test builder.
 */
export function unzipXlsx(buffer: ArrayBuffer | Uint8Array | Buffer): Map<string, Buffer> {
  const data = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer);
  const files = new Map<string, Buffer>();

  let offset = 0;
  while (offset < data.length - 4) {
    const signature = data.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      // Reached central directory or trailing record.
      break;
    }

    if (offset + 30 > data.length) {
      throw new Error('Truncated XLSX local file header');
    }

    const compressionMethod = data.readUInt16LE(offset + 8);
    const compressedSize = data.readUInt32LE(offset + 18);
    const fileNameLength = data.readUInt16LE(offset + 26);
    const extraFieldLength = data.readUInt16LE(offset + 28);
    const headerSize = 30 + fileNameLength + extraFieldLength;
    const dataStart = offset + headerSize;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > data.length) {
      throw new Error('Truncated XLSX file data');
    }

    const fileName = data.subarray(offset + 30, offset + 30 + fileNameLength).toString('utf8');
    const compressedData = data.subarray(dataStart, dataEnd);

    if (compressionMethod === 0) {
      files.set(fileName, Buffer.from(compressedData));
    } else if (compressionMethod === 8) {
      files.set(fileName, inflateRawSync(compressedData));
    } else {
      throw new Error(`Unsupported XLSX compression method: ${compressionMethod}`);
    }

    offset = dataEnd;
  }

  return files;
}

/**
 * Parse sharedStrings.xml into an indexed lookup table.
 *
 * Handles rich-text runs (<r><t>...</t></r>) and simple strings.
 */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const siMatch of xml.matchAll(/<si[\s\S]*?<\/si>/gi)) {
    const si = siMatch[0];
    // Concatenate all <t>...</t> text nodes (rich text may contain multiple).
    const parts: string[] = [];
    for (const tMatch of si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(parts.join(''));
  }
  return strings;
}

/**
 * Parse sheet1.xml into a sparse 2D array of cell values.
 *
 * Rows and cells are sorted by their r attribute, so the returned array has
 * the same shape as a sheet_to_json(..., { header: 1 }) call.
 */
export function parseWorksheet(xml: string, sharedStrings: string[]): CellValue[][] {
  const rows = new Map<number, Map<number, CellValue>>();

  for (const rowMatch of xml.matchAll(/<row\s+([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowAttrs = rowMatch[1];
    const rowContent = rowMatch[2];
    const rowNum = parseInt(extractAttr(rowAttrs, 'r') ?? '0', 10);
    if (Number.isNaN(rowNum)) continue;

    const cells = new Map<number, CellValue>();
    for (const cellMatch of rowContent.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const cellAttrs = cellMatch[1];
      const cellContent = cellMatch[2] ?? '';
      const ref = extractAttr(cellAttrs, 'r');
      if (!ref) continue;

      const colIndex = colRefToIndex(ref.replace(/\d+$/, ''));
      const type = extractAttr(cellAttrs, 't');
      const value = parseCellValue(type, cellContent, sharedStrings);
      cells.set(colIndex, value);
    }
    rows.set(rowNum, cells);
  }

  if (rows.size === 0) return [];

  const maxRow = Math.max(...rows.keys());
  const maxCol = Math.max(
    0,
    ...[...rows.values()].map((cells) => (cells.size > 0 ? Math.max(...cells.keys()) : 0))
  );

  const result: CellValue[][] = [];
  for (let r = 1; r <= maxRow; r += 1) {
    const row: CellValue[] = Array(maxCol + 1).fill('');
    const cells = rows.get(r);
    if (cells) {
      for (const [c, value] of cells) {
        row[c] = value;
      }
    }
    result.push(row);
  }
  return result;
}

function parseCellValue(type: string | null, content: string, sharedStrings: string[]): CellValue {
  if (type === 's') {
    // Shared string index.
    const v = extractTagText(content, 'v');
    const index = v !== null ? parseInt(v, 10) : NaN;
    if (!Number.isNaN(index) && index >= 0 && index < sharedStrings.length) {
      return sharedStrings[index];
    }
    return '';
  }

  if (type === 'inlineStr') {
    const text = extractTagText(content, 't');
    return text ?? '';
  }

  if (type === 'str') {
    return extractTagText(content, 'v') ?? '';
  }

  if (type === 'b') {
    const v = extractTagText(content, 'v');
    return v === '1';
  }

  // Numeric or default.
  const v = extractTagText(content, 'v');
  if (v === null || v === '') return '';
  const num = Number(v);
  return Number.isNaN(num) ? v : num;
}

function extractTagText(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? decodeXmlEntities(match[1]) : null;
}

function extractAttr(attrs: string, name: string): string | null {
  const regex = new RegExp(`\\b${name}="([^"]*)"`, 'i');
  const match = attrs.match(regex);
  return match ? match[1] : null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function colRefToIndex(ref: string): number {
  let index = 0;
  for (const ch of ref.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

// ---------------------------------------------------------------------------
// Minimal XLSX builder for tests (zero third-party dependencies).
// ---------------------------------------------------------------------------

export function buildXlsxBuffer(rows: Record<string, unknown>[]): ArrayBuffer {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const worksheetData: CellValue[][] = [
    ['Contract Notice Export', ...Array(Math.max(0, headers.length - 1)).fill('')],
    Array(headers.length).fill(''),
    headers,
    ...rows.map((r) => headers.map((h) => r[h] ?? '')),
  ];

  const { sharedStrings, sheetXml } = buildWorksheetXml(worksheetData);
  const sharedStringsXml = buildSharedStringsXml(sharedStrings);

  const entries = new Map<string, Buffer>();
  entries.set('[Content_Types].xml', Buffer.from(buildContentTypesXml(), 'utf8'));
  entries.set('_rels/.rels', Buffer.from(buildRelsXml(), 'utf8'));
  entries.set('xl/_rels/workbook.xml.rels', Buffer.from(buildWorkbookRelsXml(), 'utf8'));
  entries.set('xl/workbook.xml', Buffer.from(buildWorkbookXml(), 'utf8'));
  entries.set('xl/sharedStrings.xml', Buffer.from(sharedStringsXml, 'utf8'));
  entries.set('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));

  const zipBuffer = zipEntries(entries);
  // Copy into a dedicated ArrayBuffer so callers see exactly the ZIP bytes.
  const array = new Uint8Array(zipBuffer.length);
  array.set(zipBuffer);
  return array.buffer;
}

function buildWorksheetXml(rows: CellValue[][]): { sharedStrings: string[]; sheetXml: string } {
  const stringIndex = new Map<string, number>();
  const sharedStrings: string[] = [];

  function requireString(value: string): number {
    const existing = stringIndex.get(value);
    if (existing !== undefined) return existing;
    const idx = sharedStrings.length;
    stringIndex.set(value, idx);
    sharedStrings.push(value);
    return idx;
  }

  const rowXmls: string[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const cellXmls: string[] = [];
    for (let c = 0; c < row.length; c += 1) {
      const value = row[c];
      const ref = `${indexToColRef(c)}${r + 1}`;
      if (value === '' || value === null || value === undefined) {
        cellXmls.push(`<c r="${ref}"/>`);
      } else if (typeof value === 'string') {
        const idx = requireString(value);
        cellXmls.push(`<c r="${ref}" t="s"><v>${idx}</v></c>`);
      } else if (typeof value === 'boolean') {
        cellXmls.push(`<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`);
      } else {
        cellXmls.push(`<c r="${ref}"><v>${value}</v></c>`);
      }
    }
    rowXmls.push(`<row r="${r + 1}">${cellXmls.join('')}</row>`);
  }

  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
    ...rowXmls,
    '</sheetData>',
    '</worksheet>',
  ].join('');

  return { sharedStrings, sheetXml };
}

function buildSharedStringsXml(strings: string[]): string {
  const count = strings.length;
  const items = strings
    .map((s) => `<si><t>${encodeXmlEntities(s)}</t></si>`)
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${count}">`,
    items,
    '</sst>',
  ].join('');
}

function buildContentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
    '</Types>',
  ].join('');
}

function buildRelsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>',
  ].join('');
}

function buildWorkbookRelsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>',
    '</Relationships>',
  ].join('');
}

function buildWorkbookXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheets>',
    '<sheet name="Export" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>',
    '</sheets>',
    '</workbook>',
  ].join('');
}

function encodeXmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function indexToColRef(index: number): string {
  let ref = '';
  let n = index;
  do {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return ref;
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer for the test builder.
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
  size: number;
  compressedSize: number;
}

function zipEntries(entries: Map<string, Buffer>): Buffer {
  const zipEntries: ZipEntry[] = [];
  for (const [name, data] of entries) {
    const compressed = deflateRawSync(data);
    zipEntries.push({
      name,
      data,
      crc: crc32(data),
      compressed,
      size: data.length,
      compressedSize: compressed.length,
    });
  }

  const parts: Buffer[] = [];
  const centralDirectoryOffsets: number[] = [];

  // Local file headers + data.
  for (const entry of zipEntries) {
    centralDirectoryOffsets.push(sumLengths(parts));
    parts.push(writeLocalFileHeader(entry));
    parts.push(entry.compressed);
  }

  const centralDirectoryOffset = sumLengths(parts);

  // Central directory headers.
  for (let i = 0; i < zipEntries.length; i += 1) {
    parts.push(writeCentralDirectoryHeader(zipEntries[i], centralDirectoryOffsets[i]));
  }

  const centralDirectorySize = sumLengths(parts) - centralDirectoryOffset;

  // End of central directory record.
  parts.push(writeEndOfCentralDirectory(zipEntries.length, centralDirectorySize, centralDirectoryOffset));

  return Buffer.concat(parts);
}

function sumLengths(buffers: Buffer[]): number {
  return buffers.reduce((sum, b) => sum + b.length, 0);
}

function writeLocalFileHeader(entry: ZipEntry): Buffer {
  const nameBuffer = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // general purpose bit flag
  header.writeUInt16LE(8, 8); // compression method (deflate)
  header.writeUInt16LE(0, 10); // last mod file time
  header.writeUInt16LE(0, 12); // last mod file date
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, nameBuffer]);
}

function writeCentralDirectoryHeader(entry: ZipEntry, localOffset: number): Buffer {
  const nameBuffer = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); // signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // general purpose bit flag
  header.writeUInt16LE(8, 10); // compression method
  header.writeUInt16LE(0, 12); // last mod file time
  header.writeUInt16LE(0, 14); // last mod file date
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30); // extra field length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal file attributes
  header.writeUInt32LE(0, 38); // external file attributes
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, nameBuffer]);
}

function writeEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number
): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0); // signature
  record.writeUInt16LE(0, 4); // number of this disk
  record.writeUInt16LE(0, 6); // disk with central directory
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20); // comment length
  return record;
}

function crc32(data: Buffer): number {
  // Precomputed CRC-32 IEEE table.
  const table: number[] = [];
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }

  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
