import { z } from 'zod';

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const uuidSchema = z.string().uuid();
export const moneySchema = z
  .object({
    amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a non-negative decimal string with at most 2 decimals'),
    currency: z.string().regex(CURRENCY_PATTERN, 'currency must be an ISO-4217 uppercase code')
  })
  .strict();
