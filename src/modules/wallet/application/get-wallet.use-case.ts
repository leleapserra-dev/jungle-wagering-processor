import { Inject, Injectable } from '@nestjs/common';
import { WalletNotFoundError } from '../../../shared/domain/errors';
import type { WalletRepository } from '../domain/wallet.repository';
import type { Wallet } from '../domain/wallet';

@Injectable()
export class GetWalletUseCase {
  constructor(@Inject('WalletRepository') private readonly walletRepo: WalletRepository) {}

  async execute(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findById(walletId);
    if (wallet === null) {
      throw new WalletNotFoundError('wallet not found', { walletId });
    }
    return wallet;
  }
}
