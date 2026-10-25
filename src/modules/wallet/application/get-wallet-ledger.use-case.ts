import { Inject, Injectable } from '@nestjs/common';
import type { WalletLedgerRepository, LedgerCursor, LedgerPage } from '../domain/wallet-ledger.repository';

@Injectable()
export class GetWalletLedgerUseCase {
  constructor(@Inject('WalletLedgerRepository') private readonly ledgerRepo: WalletLedgerRepository) {}

  async execute(walletId: string, cursor: LedgerCursor | null, limit: number): Promise<LedgerPage> {
    return this.ledgerRepo.findPage(walletId, cursor, limit);
  }
}
