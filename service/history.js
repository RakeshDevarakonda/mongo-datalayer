import { ObjectId } from 'mongodb';

/**
 * Get the full history of a document — newest first.
 *
 * @param {string}        collectionName  - The collection the document belongs to.
 * @param {string|ObjectId} documentId   - The document's _id.
 * @param {object}        [options={}]
 * @param {number}        [options.limit=50]
 * @param {number}        [options.skip=0]
 * @param {boolean}       [options.pagination=true]
 * @param {string}        [options.historyCollection] - Custom history collection name.
 * @returns {Promise<object>}
 *
 * @example
 * const history = await getHistory('users', userId);
 * // { data: [...], totalDocs, currentPage, totalPages, hasNextPage }
 *
 * const history = await getHistory('users', userId, { pagination: false });
 * // plain array
 */
/**
 * Get the full history of a document.
 *
 * Standard mode (archiveAfter: false):
 *   Returns paginated flat records sorted newest first.
 *
 * Archive mode (archiveAfter: N):
 *   Each "page" is a separate archived doc holding up to N records.
 *   Pass `page` to pick which archive page to read.
 *   Defaults to the latest (active) page.
 *
 * @param {string}          collectionName
 * @param {string|ObjectId} documentId
 * @param {object}          [options={}]
 * @param {number}          [options.limit=50]       - Standard mode only
 * @param {number}          [options.skip=0]         - Standard mode only
 * @param {boolean}         [options.pagination=true] - Standard mode only
 * @param {number}          [options.page]           - Archive mode: which page to fetch (default: latest)
 * @param {string}          [options.historyCollection]
 * @returns {Promise<object>}
 */
export async function getHistory(collectionName, documentId, {
    limit             = 50,
    skip              = 0,
    pagination        = true,
    page              = null,
    historyCollection = null,
} = {}) {
    const { default: DataLayer } = await import('./datalayer.js');
    const colName = historyCollection || `${collectionName}_history`;
    const hl      = new DataLayer(colName);
    const docId   = new ObjectId(String(documentId));

    // ── Detect mode — check if archive docs exist ─────────────────────────────
    const archiveCheck = await hl.findOne({
        documentId: docId,
        collection: collectionName,
        records:    { $exists: true },
    });

    if (archiveCheck) {
        // ── Archive mode ──────────────────────────────────────────────────────
        // Count total archive pages
        const totalPages = await hl.countDocuments({
            documentId: docId,
            collection: collectionName,
        });

        // Default to latest page if not specified
        const targetPage = page ?? totalPages;

        const archiveDoc = await hl.findOne({
            documentId: docId,
            collection: collectionName,
            page:       targetPage,
        });

        if (!archiveDoc) {
            return { records: [], page: targetPage, totalPages, count: 0, archived: false };
        }

        return {
            records:    archiveDoc.records || [],
            page:       archiveDoc.page,
            totalPages,
            count:      archiveDoc.count || 0,
            archived:   archiveDoc.archived,
        };
    }

    // ── Standard mode — flat records ──────────────────────────────────────────
    return hl.find(
        { documentId: docId, collection: collectionName },
        { sort: { changedAt: -1 }, limit, skip, pagination },
    );
}

/**
 * Get the most recent change made to a document.
 *
 * @param {string}          collectionName
 * @param {string|ObjectId} documentId
 * @param {object}          [options={}]
 * @param {string}          [options.historyCollection]
 * @returns {Promise<object|null>}
 *
 * @example
 * const last = await getLastChange('users', userId);
 * // { operation: 'update', changedBy: ..., changedAt: ..., changes: [...] }
 */
export async function getLastChange(collectionName, documentId, {
    historyCollection = null,
} = {}) {
    const { default: DataLayer } = await import('./datalayer.js');
    const colName = historyCollection || `${collectionName}_history`;
    const hl      = new DataLayer(colName);

    return hl.findOne(
        { documentId: new ObjectId(String(documentId)), collection: collectionName },
        { sort: { changedAt: -1 } },
    );
}

/**
 * Restore a document to a previous snapshot stored in history.
 * Overwrites the current document with the saved snapshot.
 *
 * @param {string}          collectionName
 * @param {string|ObjectId} documentId
 * @param {string|ObjectId} historyId      - The _id of the history record to restore from.
 * @param {object}          [options={}]
 * @param {string}          [options.historyCollection]
 * @returns {Promise<object|null>} The restored document.
 *
 * @example
 * const restored = await restoreDocument('users', userId, historyId);
 */
export async function restoreDocument(collectionName, documentId, historyId, {
    historyCollection = null,
} = {}) {
    const { default: DataLayer } = await import('./datalayer.js');
    const colName  = historyCollection || `${collectionName}_history`;
    const hl       = new DataLayer(colName);
    const dl       = new DataLayer(collectionName);

    const record = await hl.findById(historyId);
    if (!record) throw new Error(`[mongo-doc-tracker] History record ${historyId} not found.`);
    if (!record.snapshot) throw new Error(`[mongo-doc-tracker] No snapshot found in history record ${historyId}.`);

    const { _id, ...snapshotData } = record.snapshot;

    return dl.updateOne(
        { _id: new ObjectId(String(documentId)) },
        { $set: snapshotData },
    );
}

/**
 * Compare two history records and return what changed between them.
 *
 * @param {string}          collectionName
 * @param {string|ObjectId} historyId1  - Earlier history record _id.
 * @param {string|ObjectId} historyId2  - Later history record _id.
 * @param {object}          [options={}]
 * @param {string}          [options.historyCollection]
 * @returns {Promise<object[]>} Array of { field, version1, version2 }
 *
 * @example
 * const diff = await compareDiff('users', historyId1, historyId2);
 * // [ { field: 'role', version1: 'user', version2: 'admin' } ]
 */
export async function compareDiff(collectionName, historyId1, historyId2, {
    historyCollection = null,
} = {}) {
    const { default: DataLayer } = await import('./datalayer.js');
    const colName = historyCollection || `${collectionName}_history`;
    const hl      = new DataLayer(colName);

    const [r1, r2] = await Promise.all([
        hl.findById(historyId1),
        hl.findById(historyId2),
    ]);

    if (!r1) throw new Error(`[mongo-doc-tracker] History record ${historyId1} not found.`);
    if (!r2) throw new Error(`[mongo-doc-tracker] History record ${historyId2} not found.`);

    const s1      = r1.snapshot || {};
    const s2      = r2.snapshot || {};
    const allKeys = new Set([...Object.keys(s1), ...Object.keys(s2)]);
    const diffs   = [];

    for (const key of allKeys) {
        if (key === '_id') continue;
        if (JSON.stringify(s1[key]) !== JSON.stringify(s2[key])) {
            diffs.push({ field: key, version1: s1[key] ?? null, version2: s2[key] ?? null });
        }
    }
    return diffs;
}
