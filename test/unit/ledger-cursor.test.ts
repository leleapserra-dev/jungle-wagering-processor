import { describe, expect, test } from 'bun:test';
import { AppException } from '../../src/shared/presentation/exception-filter';
import { decodeLedgerCursor, encodeLedgerCursor } from '../../src/modules/wallet/presentation/ledger-cursor';

const validId = '0192f7c0-0000-7000-8000-000000000001';
const validDate = new Date('2026-01-01T00:00:00.000Z');

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('ledger cursor', () => {
  test('round-trips a valid cursor', () => {
    const encoded = encodeLedgerCursor({ createdAt: validDate, id: validId });
    expect(decodeLedgerCursor(encoded)).toEqual({ createdAt: validDate, id: validId });
  });

  test('treats a missing cursor as the first page', () => {
    expect(decodeLedgerCursor(undefined)).toBeNull();
  });

  test('rejects an empty cursor', () => {
    expect(() => decodeLedgerCursor('')).toThrow(AppException);
  });

  test('rejects non-base64url input', () => {
    expect(() => decodeLedgerCursor('not a cursor!')).toThrow(AppException);
  });

  test('rejects valid base64url that is not JSON', () => {
    expect(() => decodeLedgerCursor(Buffer.from('{', 'utf8').toString('base64url'))).toThrow(AppException);
  });

  test('rejects missing fields', () => {
    expect(() => decodeLedgerCursor(base64url({ id: validId }))).toThrow(AppException);
  });

  test('rejects an invalid timestamp', () => {
    expect(() => decodeLedgerCursor(base64url({ createdAt: 'not-a-date', id: validId }))).toThrow(AppException);
  });

  test('rejects a SQL injection attempt in the id', () => {
    const cursor = base64url({ createdAt: validDate.toISOString(), id: "x' OR '1'='1" });
    expect(() => decodeLedgerCursor(cursor)).toThrow(AppException);
  });

  test('rejects oversized cursors', () => {
    expect(() => decodeLedgerCursor('a'.repeat(513))).toThrow(AppException);
  });
});
