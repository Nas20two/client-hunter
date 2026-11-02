import { test } from 'node:test';
import assert from 'node:assert';
import { VicTendersOpenAdapter } from '../vic-tenders-open.js';
import { fixtureHtml } from '../__fixtures__/vic-tenders-open.fixture.js';

test('parses two VIC tender rows from the fixture HTML', () => {
  const adapter = new VicTendersOpenAdapter();
  const candidates = adapter.parseOpenList(fixtureHtml);

  assert.strictEqual(candidates.length, 2);

  const first = candidates[0];
  assert.strictEqual(first.source, 'vic-tenders-open');
  assert.ok(first.sourceId.startsWith('procf22-000236-'));
  assert.strictEqual(first.rawData.rfxNumber, 'PROCF22-000236');
  assert.strictEqual(first.rawData.title, 'Road Safety Services Register');
  assert.strictEqual(first.rawData.agency, 'Transport Accident Commission');
  assert.strictEqual(first.rawData.status, 'Open');
  assert.strictEqual(first.rawData.type, 'Expression of Interest');
  assert.strictEqual(first.rawData.openDate, 'Fri, 10 March 2023 9:15 am');
  assert.strictEqual(first.rawData.closeDate, 'Fri, 01 March 2030 2:00 pm');
  assert.strictEqual(first.sourceUrl, 'https://www.tenders.vic.gov.au/tender/view?id=249237');
  assert.deepStrictEqual(first.rawData.unspsc, [
    '80000000 - Management and Business Professionals and Administrative Services',
  ]);

  const second = candidates[1];
  assert.strictEqual(second.rawData.rfxNumber, 'ITR-SS-05-2018');
  assert.ok((second.rawData.title as string).includes('Ethical Supplier Register'));
  assert.strictEqual(second.rawData.agency, 'Department of Treasury and Finance');
  assert.strictEqual(second.rawData.type, 'Request for Tender');
  assert.strictEqual(second.sourceUrl, 'https://www.tenders.vic.gov.au/tender/view?id=97410');
  assert.strictEqual((second.rawData.unspsc as string[]).length, 2);
});
