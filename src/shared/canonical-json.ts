type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON does not accept non-finite numbers');
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (typeof value === 'object') {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        sorted[key] = sortValue(entry);
      }
    }
    return sorted;
  }

  throw new TypeError(`canonical JSON does not accept values of type ${typeof value}`);
}
