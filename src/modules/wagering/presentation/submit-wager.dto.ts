import { z } from 'zod';
import { moneySchema, uuidSchema } from '../../../shared/presentation/schemas';

export const submitWagerSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    externalTransactionId: z.string().min(1).max(256),
    playerId: z.string().min(1).max(128),
    walletId: uuidSchema,
    roundId: z.string().min(1).max(128),
    gameId: z.string().min(1).max(128),
    kind: z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']),
    money: moneySchema,
    referenceExternalTransactionId: z.string().min(1).max(256).optional()
  })
  .strict();

export type SubmitWagerBody = z.infer<typeof submitWagerSchema>;

export const idempotencyKeySchema = z.string().min(1).max(200);
