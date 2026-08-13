// Data source primitives
export interface Candidate {
  source: string;
  sourceId: string;
  sourceUrl: string;
  rawData: Record<string, unknown>;
  discoveredAt: string;
}

export interface VerifiedCandidate extends Candidate {
  verified: true;
  evidenceLog: string[];
  verificationSource: string;
}

export interface ScoredCandidate extends VerifiedCandidate {
  scores: Record<string, number>;
  topProduct: string;
  topScore: number;
  fitBadge: 'Strong Match' | 'Good Match' | 'Stretch Match';
}

// Channel-facing lead card
export interface LeadCard {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceUrl: string;
  product: string;
  agency: string;
  title: string;
  closeDate?: string;
  contacts: {
    name?: string;
    role?: string;
    url?: string;
    email?: string;
    emailStatus?: 'found-verified' | 'found-unverified' | 'none';
    verifiedAt?: string;
  }[];
  evidence: { quote: string; url: string }[];
  whyThemBullets: string[];
  fitScore: number;
  scoreBreakdown: Record<string, number>;
  fitBadge: 'Strong Match' | 'Good Match' | 'Stretch Match';
  draftEmail: {
    subject: string;
    body: string;
    footer: string;
  };
  status:
    | 'new'
    | 'reviewing'
    | 'approved'
    | 'sent'
    | 'replied'
    | 'dead';
  createdAt: string;
  buzzEventId?: string;
}

export interface CompanyEntry {
  domain: string;
  agency: string;
  firstSeen: string;
  lastSeen: string;
  leadIds: string[];
  status: 'prospect' | 'contacted' | 'engaged' | 'customer' | 'cold';
  doNotContact: boolean;
  dncReason?: string;
  dncAt?: string;
}

export interface SourceAdapter {
  name: string;
  discover(): Promise<Candidate[]>;
}
