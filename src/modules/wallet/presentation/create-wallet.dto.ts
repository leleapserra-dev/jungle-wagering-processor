import { z } from 'zod';
import { moneySchema } from '../../../shared/presentation/schemas';

export const createWalletSchema = z
  .object({
    playerId: z.string().min(1).max(128),
    initialBalance: moneySchema
  })
  .strict();

export type CreateWalletBody = z.infer<typeof createWalletSchema>;
