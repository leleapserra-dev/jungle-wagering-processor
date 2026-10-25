import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json';

export interface PayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { amount: string; currency: string };
  referenceExternalTransactionId: string | null;
}

export interface PayloadHasher {
  hash(input: PayloadHashInput): string;
}

export class Sha256PayloadHasher implements PayloadHasher {
  hash(input: PayloadHashInput): string {
    return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex');
  }
}
