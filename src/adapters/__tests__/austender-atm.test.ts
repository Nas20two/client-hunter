import { test } from 'node:test';
import assert from 'node:assert';
import { AusTenderAtmAdapter } from '../austender-atm.js';

const sample = `Program 3 - Integrated disease management of Ascochyta blight

ATM ID:

Close Date & Time:

14-Aug-2026 5:00 pm (ACT Local Time)

Agency:

Grains Research and Development Corporation

Category:

Crop production and management and protection

Description:

Program 3 - Integrated disease management...

**Last Updated:** 18-Jun-2026 9:47 am (ACT Local Time)

Program 2 - Delivering improved resistance

ATM ID:

Close Date & Time:

14-Aug-2026 5:00 pm (ACT Local Time)

Agency:

Grains Research and Development Corporation

Category:

Crop production and management and protection

Description:

Program 2 - Delivering improved...

**Last Updated:** 18-Jun-2026 9:47 am (ACT Local Time)
`;

test('parses two ATM records from Jina markdown', () => {
  const adapter = new AusTenderAtmAdapter();
  const candidates = adapter.parseAtmList(sample, 'source-url');
  assert.strictEqual(candidates.length, 2);
  assert.ok(candidates[0].sourceId.includes('grains'));
  assert.strictEqual(candidates[0].rawData.agency, 'Grains Research and Development Corporation');
  assert.strictEqual(candidates[0].rawData.closeDate, '14-Aug-2026 5:00 pm (ACT Local Time)');
});
