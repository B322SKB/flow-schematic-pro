export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistedBackupResult {
  sourceKey: string;
  backupKey: string;
  created: boolean;
  hadSourceValue: boolean;
}

/**
 * Copies the exact persisted payload to a separate key before a schema/identity
 * migration. The original key is never changed by this function.
 *
 * Existing backups are immutable: an identical backup is reused, while a
 * different backup causes a fail-closed error instead of overwriting it.
 */
export function backupPersistedValue(
  storage: KeyValueStorage,
  sourceKey: string,
  backupKey = `${sourceKey}:pre-migration-backup`,
): PersistedBackupResult {
  if (!sourceKey || !backupKey || sourceKey === backupKey) {
    throw new Error("Source and backup keys must be distinct non-empty values");
  }

  const source = storage.getItem(sourceKey);
  if (source === null) {
    return { sourceKey, backupKey, created: false, hadSourceValue: false };
  }

  const existingBackup = storage.getItem(backupKey);
  if (existingBackup !== null) {
    if (existingBackup !== source) {
      throw new Error(`Backup already exists with different content: ${backupKey}`);
    }
    return { sourceKey, backupKey, created: false, hadSourceValue: true };
  }

  storage.setItem(backupKey, source);
  if (storage.getItem(backupKey) !== source) {
    throw new Error(`Backup verification failed: ${backupKey}`);
  }

  // Verify the source was not altered by a custom/hostile storage adapter.
  if (storage.getItem(sourceKey) !== source) {
    throw new Error(`Source value changed while creating backup: ${sourceKey}`);
  }

  return { sourceKey, backupKey, created: true, hadSourceValue: true };
}

/**
 * Explicit recovery operation. It restores the exact backup payload and
 * verifies the write; callers should expose this only as a deliberate action.
 */
export function restorePersistedValue(
  storage: KeyValueStorage,
  sourceKey: string,
  backupKey = `${sourceKey}:pre-migration-backup`,
): void {
  const backup = storage.getItem(backupKey);
  if (backup === null) throw new Error(`Backup not found: ${backupKey}`);
  storage.setItem(sourceKey, backup);
  if (storage.getItem(sourceKey) !== backup) {
    throw new Error(`Restore verification failed: ${sourceKey}`);
  }
}
