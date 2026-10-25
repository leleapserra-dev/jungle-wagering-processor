import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../../../shared/presentation/exception-filter';
import type { LedgerCursor } from '../domain/wallet-ledger.repository';

const MAX_CURSOR_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid()
});

function invalidCursor(): AppException {
  return new AppException('BAD_REQUEST', 'invalid cursor', HttpStatus.BAD_REQUEST);
}

export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8').toString(
    'base64url'
  );
}

export function decodeLedgerCursor(value: string | undefined): LedgerCursor | null {
  if (value === undefined) return null;
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(value)) {
    throw invalidCursor();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const parsed = cursorPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidCursor();
  }

  return { createdAt: new Date(parsed.data.createdAt), id: parsed.data.id };
}
