import type { Scheme } from "./types";
import { upgradeSchemeEntityIds, type IdFactory } from "./cad-identity";
import { backupPersistedValue, type KeyValueStorage, type PersistedBackupResult } from "./persisted-backup";

export interface PersistedProjectIdentityFailure {
  index: number;
  projectId: string | null;
  reason: string;
}

export interface PersistedIdentityUpgradeResult<T> {
  state: T;
  migratedProjectIds: string[];
  failedProjects: PersistedProjectIdentityFailure[];
}

export interface PersistedIdentityMigrationResult<T> extends PersistedIdentityUpgradeResult<T> {
  backup: PersistedBackupResult;
}

/**
 * Upgrade each persisted project independently.
 * Invalid projects are retained by object identity; one bad project does not
 * prevent valid projects from being upgraded.
 */
export function upgradePersistedProjectIdentities<T>(
  persisted: T,
  idFactory: IdFactory = () => crypto.randomUUID(),
): PersistedIdentityUpgradeResult<T> {
  if (!persisted || typeof persisted !== "object" || !Array.isArray((persisted as { projects?: unknown }).projects)) {
    return { state: persisted, migratedProjectIds: [], failedProjects: [] };
  }

  const record = persisted as T & { projects: unknown[] };
  const migratedProjectIds: string[] = [];
  const failedProjects: PersistedProjectIdentityFailure[] = [];

  const projects = record.projects.map((project, index) => {
    const projectId =
      project && typeof project === "object" && "id" in project && typeof project.id === "string"
        ? project.id
        : null;

    try {
      if (
        !project ||
        typeof project !== "object" ||
        !Array.isArray((project as { nodes?: unknown }).nodes) ||
        !Array.isArray((project as { pipes?: unknown }).pipes)
      ) {
        throw new Error("Project does not contain valid nodes and pipes arrays");
      }

      const result = upgradeSchemeEntityIds(project as Scheme, idFactory);
      if (result.changed) migratedProjectIds.push(result.scheme.id);
      return result.scheme;
    } catch (error) {
      failedProjects.push({
        index,
        projectId,
        reason: error instanceof Error ? error.message : "Unknown identity migration error",
      });
      return project;
    }
  });

  return {
    state: { ...record, projects } as T,
    migratedProjectIds,
    failedProjects,
  };
}

/**
 * Back up the exact raw Zustand storage value before upgrading entity IDs.
 * A missing source or failed backup aborts migration before Zustand can write
 * the upgraded state. Per-project failures are retained and reported.
 */
export function migratePersistedPidState<T>(
  persisted: T,
  storage: KeyValueStorage,
  storageKey: string,
  idFactory: IdFactory = () => crypto.randomUUID(),
): PersistedIdentityMigrationResult<T> {
  const backup = backupPersistedValue(storage, storageKey);
  if (!backup.hadSourceValue) {
    throw new Error(`Cannot migrate persisted PID state: source storage value is missing (${storageKey})`);
  }

  const upgrade = upgradePersistedProjectIdentities(persisted, idFactory);
  if (upgrade.failedProjects.length) {
    const details = upgrade.failedProjects
      .map((failure) => `#${failure.index} (${failure.projectId ?? "unknown"}): ${failure.reason}`)
      .join("; ");
    throw new Error(`PID identity migration aborted; no projects were committed because some projects are invalid: ${details}`);
  }

  return {
    ...upgrade,
    backup,
  };
}
