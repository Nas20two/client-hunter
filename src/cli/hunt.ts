import { AusTenderAtmAdapter } from '../adapters/austender-atm.js';

async function main() {
  console.log('client-hunter hunt stub');
  const adapter = new AusTenderAtmAdapter();
  try {
    const candidates = await adapter.discover();
    console.log(`Discovered ${candidates.length} candidates from ${adapter.name}`);
    console.log(JSON.stringify(candidates.slice(0, 3), null, 2));
  } catch (err) {
    console.error('Hunt failed:', err);
    process.exit(1);
  }
}

main();
