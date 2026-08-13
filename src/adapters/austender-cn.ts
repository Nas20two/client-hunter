import { SourceAdapter, Candidate } from '../types.js';

/**
 * AusTender Contract Notice export adapter (Phase 1 secondary signal).
 *
 * The weekly export is an .xlsx; direct download works only from a
 * browser-like client. For Phase 1 this adapter is a stub that would
 * fetch the XLSX, parse it with a sheet reader, and return candidates.
 */
export class AusTenderCnAdapter implements SourceAdapter {
  name = 'austenderCn';

  async discover(): Promise<Candidate[]> {
    // TODO: implement XLSX fetch + parse once we have a portable sheet reader.
    return [];
  }
}
