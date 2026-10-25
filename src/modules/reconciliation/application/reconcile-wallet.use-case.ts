import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WalletRepository } from '../../wallet/domain/wallet.repository';
import type { WalletLedgerRepository } from '../../wallet/domain/wallet-ledger.repository';
import { WalletNotFoundError } from '../../../shared/domain/errors';
import { reconciliationRunsTotal } from '../../../shared/observability/metrics';

export interface ReconciliationResult {
  walletId: string;
  storedBalance: { amount: string; currency: string };
  calculatedBalance: { amount: string; currency: string };
  difference: { amount: string; currency: string };
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWalletUseCase {
  private readonly logger = new Logger(ReconcileWalletUseCase.name);

  constructor(
    @Inject('WalletRepository') private readonly walletRepo: WalletRepository,
    @Inject('WalletLedgerRepository') private readonly ledgerRepo: WalletLedgerRepository
  ) {}
  async execute(walletId: string): Promise<ReconciliationResult> {
    const wallet = await this.walletRepo.findById(walletId);
    if (wallet === null) {
      throw new WalletNotFoundError('wallet not found', { walletId });
    }
    const calculated = await this.ledgerRepo.calculateBalance(walletId, wallet.currency);
    const stored = wallet.balance;
    const diff = stored.subtract(calculated);
    const consistent = diff.isZero();
    const checked = await this.ledgerRepo.count(walletId);

    reconciliationRunsTotal.inc({ result: consistent ? 'consistent' : 'divergent' });
    if (!consistent) {
      // Divergences are never corrected silently: log, count and report them.
      this.logger.error({
        msg: 'wallet reconciliation found a divergence',
        walletId,
        storedBalance: stored.toJSON(),
        calculatedBalance: calculated.toJSON(),
        difference: diff.toJSON(),
        checkedEntries: checked
      });
    }
    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: diff.toJSON(),
      consistent,
      checkedEntries: checked
    };
  }
}
