import { ObjectId } from 'mongodb';
import {
    getGlobalConfig,
    getTimestamp,
    computeDiff,
    buildHistoryEntry,
    trimHistory,
} from './tracker.js';

/**
 * @class TrackedDataLayer
 *
 * A drop-in replacement for DataLayer that automatically tracks
 * every create / update / delete operation on a collection.
 *
 * Requires mongo-datalayer to be installed and connected.
 *
 * @example
 * import { TrackedDataLayer } from 'mongo-doc-tracker';
 *
 * const users = new TrackedDataLayer('users', req.user, {
 *     track:        true,
 *     storage:      'collection',
 *     collection:   'users_history',
 *     maxHistory:   50,
 *     watchFields:  ['role', 'email'],
 *     ignoreFields: ['updatedAt'],
 *     operations:   ['update', 'delete'],
 * });
 */
class TrackedDataLayer {
    constructor(collectionName, reqUser = null, options = {}) {
        const global = getGlobalConfig();

        this.collectionName = collectionName;
        this.reqUser        = reqUser;

        // Merge global config with instance options (instance wins)
        this.opts = {
            track:        options.track        ?? global.track,
            storage:      options.storage      ?? global.storage,
            collection:   options.collection   ?? global.collection   ?? `${collectionName}_history`,
            historyField: options.historyField ?? global.historyField ?? '__history',
            maxHistory:   options.maxHistory   ?? global.maxHistory   ?? 0,
            archiveAfter: options.archiveAfter ?? global.archiveAfter ?? false,
            watchFields:  options.watchFields  ?? global.watchFields  ?? [],
            ignoreFields: options.ignoreFields ?? global.ignoreFields ?? [],
            operations:   options.operations   ?? global.operations   ?? ['create', 'update', 'delete'],
            meta:         options.meta         ?? global.meta         ?? {},
        };

        // Lazy-loaded DataLayer instances
        this._dl      = null;   // main collection
        this._history = null;   // history collection (when storage: 'collection')
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    async _getDataLayer() {
        if (!this._dl) {
            const { default: DataLayer } = await import('./datalayer.js');
            this._dl = new DataLayer(this.collectionName, this.reqUser);
        }
        return this._dl;
    }

    async _getHistoryLayer() {
        if (!this._history) {
            const { default: DataLayer } = await import('./datalayer.js');
            this._history = new DataLayer(this.opts.collection);
        }
        return this._history;
    }

    /** Returns true if this operation type should be tracked */
    _shouldTrack(operation) {
        return this.opts.track && this.opts.operations.includes(operation);
    }

    /** Save history to a separate collection — with archiveAfter or maxHistory support */
    async _saveToCollection(documentId, entry) {
        const hl    = await this._getHistoryLayer();
        const docId = new ObjectId(String(documentId));

        // ── archiveAfter mode ─────────────────────────────────────────────────
        if (this.opts.archiveAfter && this.opts.archiveAfter > 0) {
            // Find the current active (non-archived) page doc for this document
            let activePage = await hl.findOne({
                documentId: docId,
                collection: this.collectionName,
                archived:   false,
            });

            if (!activePage) {
                // No active page yet — create page 1
                activePage = await hl.insertOne({
                    documentId: docId,
                    collection: this.collectionName,
                    page:       1,
                    archived:   false,
                    count:      0,
                    records:    [],
                });
            }

            // Push new entry into the active page
            const newCount = (activePage.count || 0) + 1;
            const isNowFull = newCount >= this.opts.archiveAfter;

            await hl.updateOne(
                { _id: activePage._id },
                {
                    $push: { records: entry },
                    $set:  {
                        count:    newCount,
                        archived: isNowFull,  // mark full if limit reached
                    },
                },
            );

            // If this page is now full, create a new empty active page
            if (isNowFull) {
                await hl.insertOne({
                    documentId: docId,
                    collection: this.collectionName,
                    page:       (activePage.page || 1) + 1,
                    archived:   false,
                    count:      0,
                    records:    [],
                });
            }
            return;
        }

        // ── Standard mode (flat records) ──────────────────────────────────────
        await hl.insertOne({
            documentId: docId,
            collection: this.collectionName,
            ...entry,
        });

        // Trim oldest if maxHistory is set
        if (this.opts.maxHistory > 0) {
            const allRecords = await hl.find(
                { documentId: docId, collection: this.collectionName },
                { sort: { changedAt: 1 }, pagination: false },
            );
            if (allRecords.length > this.opts.maxHistory) {
                const toDelete = allRecords
                    .slice(0, allRecords.length - this.opts.maxHistory)
                    .map(r => r._id);
                await hl.deleteMany({ _id: { $in: toDelete } });
            }
        }
    }

    /** Save history inline inside the document */
    async _saveInline(documentId, entry) {
        const dl      = await this._getDataLayer();
        const doc     = await dl.findById(documentId);
        if (!doc) return;

        const existing = doc[this.opts.historyField] || [];
        const updated  = trimHistory([...existing, entry], this.opts.maxHistory);

        await dl.updateOne(
            { _id: new ObjectId(String(documentId)) },
            { $set: { [this.opts.historyField]: updated } },
        );
    }

    /** Route to the correct storage strategy */
    async _record(documentId, operation, changes, snapshot, meta = {}) {
        if (!this._shouldTrack(operation)) return;

        // Instance meta is the base — per-operation meta overrides/extends it
        const mergedMeta = { ...this.opts.meta, ...meta };

        const entry = buildHistoryEntry(
            operation,
            changes,
            snapshot,
            this.reqUser?.id ?? null,
            mergedMeta,
        );

        if (this.opts.storage === 'inline') {
            await this._saveInline(documentId, entry);
        } else {
            await this._saveToCollection(documentId, entry);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CREATE
    // ══════════════════════════════════════════════════════════════════════════

    async create(data, { meta = {} } = {}) {
        return this.insertOne(data, { meta });
    }

    async insertOne(data, { meta = {} } = {}) {
        const dl  = await this._getDataLayer();
        const doc = await dl.insertOne(data);

        await this._record(doc._id, 'create', [], doc, meta);
        return doc;
    }

    async insertMany(docs, options = {}, { meta = {} } = {}) {
        const dl       = await this._getDataLayer();
        const inserted = await dl.insertMany(docs, options);

        if (this._shouldTrack('create')) {
            for (const doc of inserted) {
                await this._record(doc._id, 'create', [], doc, meta);
            }
        }
        return inserted;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  READ (pass-through — no tracking needed)
    // ══════════════════════════════════════════════════════════════════════════

    async findById(id, projection)                        { return (await this._getDataLayer()).findById(id, projection); }
    async findOne(filter, options)                         { return (await this._getDataLayer()).findOne(filter, options); }
    async find(filter, options)                            { return (await this._getDataLayer()).find(filter, options); }
    async exists(filter)                                   { return (await this._getDataLayer()).exists(filter); }
    async distinct(field, filter)                          { return (await this._getDataLayer()).distinct(field, filter); }
    async countDocuments(filter)                           { return (await this._getDataLayer()).countDocuments(filter); }
    async estimatedCount()                                 { return (await this._getDataLayer()).estimatedCount(); }
    async aggregate(pipeline, options)                     { return (await this._getDataLayer()).aggregate(pipeline, options); }
    async groupBy(field, accumulators, matchFilter)        { return (await this._getDataLayer()).groupBy(field, accumulators, matchFilter); }
    getCursor(filter, options)                             { return this._getDataLayer().then(dl => dl.getCursor(filter, options)); }

    // ══════════════════════════════════════════════════════════════════════════
    //  UPDATE
    // ══════════════════════════════════════════════════════════════════════════

    async findByIdAndUpdate(id, updateObj, arrayFilters, options = {}, { meta = {} } = {}) {
        const dl     = await this._getDataLayer();
        const before = await dl.findById(id);
        const after  = await dl.findByIdAndUpdate(id, updateObj, arrayFilters, options);

        if (after) {
            const changes = computeDiff(before, after, this.opts.watchFields, this.opts.ignoreFields);
            await this._record(id, 'update', changes, after, meta);
        }
        return after;
    }

    async updateOne(filter, updateObj, arrayFilters, options = {}, { meta = {} } = {}) {
        const dl     = await this._getDataLayer();
        const before = await dl.findOne(filter);
        const after  = await dl.updateOne(filter, updateObj, arrayFilters, options);

        if (after) {
            const changes = computeDiff(before, after, this.opts.watchFields, this.opts.ignoreFields);
            await this._record(after._id, 'update', changes, after, meta);
        }
        return after;
    }

    async updateMany(filter, updateObj) {
        const dl     = await this._getDataLayer();
        const result = await dl.updateMany(filter, updateObj);

        // For updateMany track each doc individually
        if (this._shouldTrack('update')) {
            const docs = await dl.find(filter, { pagination: false });
            for (const doc of docs) {
                await this._record(doc._id, 'update', [], doc);
            }
        }
        return result;
    }

    async upsert(filter, updateObj, options = {}, { meta = {} } = {}) {
        const dl     = await this._getDataLayer();
        const before = await dl.findOne(filter);
        const after  = await dl.upsert(filter, updateObj, options);

        if (after) {
            const op      = before ? 'update' : 'create';
            const changes = before
                ? computeDiff(before, after, this.opts.watchFields, this.opts.ignoreFields)
                : [];
            await this._record(after._id, op, changes, after, meta);
        }
        return after;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DELETE
    // ══════════════════════════════════════════════════════════════════════════

    async findByIdAndDelete(id, { meta = {} } = {}) {
        const dl      = await this._getDataLayer();
        const deleted = await dl.findByIdAndDelete(id);

        if (deleted) {
            await this._record(id, 'delete', [], deleted, meta);
        }
        return deleted;
    }

    async deleteOne(filter, { meta = {} } = {}) {
        const dl      = await this._getDataLayer();
        const deleted = await dl.deleteOne(filter);

        if (deleted) {
            await this._record(deleted._id, 'delete', [], deleted, meta);
        }
        return deleted;
    }

    async deleteMany(filter) {
        const dl   = await this._getDataLayer();

        if (this._shouldTrack('delete')) {
            const docs = await dl.find(filter, { pagination: false });
            const result = await dl.deleteMany(filter);
            for (const doc of docs) {
                await this._record(doc._id, 'delete', [], doc);
            }
            return result;
        }
        return dl.deleteMany(filter);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  BULK
    // ══════════════════════════════════════════════════════════════════════════

    async bulkWrite(ops, options = {})       { return (await this._getDataLayer()).bulkWrite(ops, options); }
    async bulkUpsert(docs, matchField)       { return (await this._getDataLayer()).bulkUpsert(docs, matchField); }
    async bulkDelete(filter)                 { return (await this._getDataLayer()).bulkDelete(filter); }

    // ══════════════════════════════════════════════════════════════════════════
    //  INDEXES / UTILS
    // ══════════════════════════════════════════════════════════════════════════

    async createIndex(keyPattern, options)   { return (await this._getDataLayer()).createIndex(keyPattern, options); }
    async createIndexes(indexes)             { return (await this._getDataLayer()).createIndexes(indexes); }
    async dropIndex(indexNameOrSpec)         { return (await this._getDataLayer()).dropIndex(indexNameOrSpec); }
    async dropIndexes()                      { return (await this._getDataLayer()).dropIndexes(); }
    async listIndexes()                      { return (await this._getDataLayer()).listIndexes(); }
    toObjectId(id)                           { return new ObjectId(String(id)); }
    isValidObjectId(id)                      { return ObjectId.isValid(id); }
    async getCollection()                    { return (await this._getDataLayer()).getCollection(); }
}

export default TrackedDataLayer;
