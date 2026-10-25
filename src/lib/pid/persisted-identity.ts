import type { Scheme } from "./types";
import { upgradeSchemeEntityIds, type IdFactory } from "./cad-identity";

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

/**
 * Upgrade each persisted project independently.
 *
 * Invalid projects are retained byte-for-byte at the object level; one bad
 * project must not prevent the remaining projects from being upgraded.
 * This helper is intentionally pure and does not write browser storage.
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
