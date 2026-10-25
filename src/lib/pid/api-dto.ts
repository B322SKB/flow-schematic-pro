import type { Scheme } from "./types";

/**
 * Transport envelope for one P&ID drawing. The enclosed Scheme remains the
 * domain snapshot; formatVersion versions this API representation separately
 * from Scheme.schemaVersion, which migrates browser-persisted model data.
 */
export interface SchemeSnapshotDto {
  formatVersion: 1;
  scheme: Scheme;
}

/** Wrap a domain Scheme without reshaping or dropping engineering properties. */
export function serializeSchemeSnapshot(scheme: Scheme): SchemeSnapshotDto {
  return { formatVersion: 1, scheme };
}

/**
 * Validate the stable outer contract at an API boundary. Detailed engineering
 * invariants remain owned by the P&ID domain model and its existing validators.
 */
export function parseSchemeSnapshotDto(value: unknown): SchemeSnapshotDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Scheme snapshot DTO");
  }

  const dto = value as Record<string, unknown>;
  if (dto.formatVersion !== 1) {
    throw new Error(`Unsupported Scheme snapshot DTO format version: ${String(dto.formatVersion)}`);
  }

  const scheme = dto.scheme;
  if (
    !scheme ||
    typeof scheme !== "object" ||
    Array.isArray(scheme) ||
    typeof (scheme as Record<string, unknown>).id !== "string" ||
    typeof (scheme as Record<string, unknown>).name !== "string" ||
    typeof (scheme as Record<string, unknown>).revision !== "string" ||
    !Number.isFinite((scheme as Record<string, unknown>).updatedAt) ||
    !Array.isArray((scheme as Record<string, unknown>).nodes) ||
    !Array.isArray((scheme as Record<string, unknown>).pipes)
  ) {
    throw new Error("Invalid Scheme snapshot");
  }

  return { formatVersion: 1, scheme: scheme as Scheme };
}
