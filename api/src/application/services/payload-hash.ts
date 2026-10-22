import { createHash } from 'node:crypto';

/**
 * Canonical JSON hash for business payload idempotency.
 * Algorithm: SHA-256 over UTF-8 of canonicalize(businessFields).
 * - Object keys sorted lexicographically at every nesting level
 * - Transport headers / messageId / occurredAt excluded (caller passes only business subset)
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function hashPayload(businessFields: Record<string, unknown>): string {
  const canonical = canonicalize(businessFields);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function businessFieldsFromWager(input: {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: {
      amount: input.money.amount,
      currency: input.money.currency,
    },
  };
  if (input.referenceExternalTransactionId !== undefined) {
    fields.referenceExternalTransactionId = input.referenceExternalTransactionId;
  }
  return fields;
}
