import { z } from 'zod';

export const ledgerQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict();

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
