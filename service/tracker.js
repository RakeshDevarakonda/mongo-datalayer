import { ObjectId } from 'mongodb';

// ─── Global config ────────────────────────────────────────────────────────────

let _globalConfig = {
    track:        true,
    storage:      'collection',
    collection:   null,
    historyField: '__history',
    maxHistory:   0,
    archiveAfter: false,
    watchFields:  [],
    ignoreFields: [],
    operations:   ['create', 'update', 'delete'],
    meta:         {},
};

/**
 * Set global defaults for all TrackedDataLayer instances.
 *
 * @param {object} config
 *
 * @example
 * configureTracker({
 *     track:        true,
 *     storage:      'collection',
 *     maxHistory:   50,
 *     ignoreFields: ['updatedAt', 'lastSeen'],
 *     operations:   ['update', 'delete'],
 * });
 */
export function configureTracker(config = {}) {
    _globalConfig = { ..._globalConfig, ...config };
}

export function getGlobalConfig() {
    return _globalConfig;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getTimestamp() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Compute field-level diff between two plain objects.
 * Returns only fields that actually changed.
 */
export function computeDiff(before, after, watchFields = [], ignoreFields = []) {
    const changes = [];
    const allKeys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after  || {}),
    ]);

    for (const key of allKeys) {
        // Skip internal Mongo fields and ignored fields
        if (key === '_id')                   continue;
        if (ignoreFields.includes(key))      continue;
        if (watchFields.length && !watchFields.includes(key)) continue;

        const from = before?.[key];
        const to   = after?.[key];

        if (JSON.stringify(from) !== JSON.stringify(to)) {
            changes.push({ field: key, from: from ?? null, to: to ?? null });
        }
    }
    return changes;
}

/**
 * Build a single history entry object.
 */
export function buildHistoryEntry(operation, changes, snapshot, changedBy, meta = {}) {
    return {
        operation,
        changedBy: changedBy ? new ObjectId(String(changedBy)) : null,
        changedAt: getTimestamp(),
        changes,
        snapshot,
        ...meta,   // spread custom fields — e.g. reason, ipAddress, source
    };
}

/**
 * Trim history array to maxHistory — keeps the most recent entries.
 */
export function trimHistory(history, maxHistory) {
    if (!maxHistory || maxHistory === 0) return history;
    return history.slice(-maxHistory);
}
