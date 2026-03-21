import { ObjectId } from 'mongodb';
import { getCollection } from '../config/mongodb.js';
import { getTimestamp, selectToProject } from '../helpers/datetime.js';

/**
 * @class DataLayer
 *
 * A generic data layer for a single MongoDB collection.
 * Provides every common MongoDB operation with automatic audit fields
 * (createdAt, updatedAt, createdBy, updatedBy).
 *
 * @example
 * const users = new DataLayer('users', reqUser);
 * const page  = await users.find({ active: true }, { limit: 20 });
 * const user  = await users.findById('abc123');
 */
class DataLayer {
    /**
     * @param {string}      collection          - MongoDB collection name.
     * @param {object|null} [reqUser=null]       - Authenticated user for audit tracking.
     * @param {string}      reqUser.id           - User's ID (string or ObjectId).
     */
    constructor(collection, reqUser = null) {
        this.collectionName = collection;
        this.reqUser        = reqUser;
    }

    // ─── Internal helpers ───────────────────────────────────────────────────

    /** @returns {import('mongodb').Collection} */
    _col() {
        return getCollection(this.collectionName);
    }

    /** @returns {object} Fields to merge on create */
    _auditCreate() {
        const ts = getTimestamp();
        return {
            createdAt: ts,
            updatedAt: ts,
            ...(this.reqUser && {
                createdBy: new ObjectId(String(this.reqUser.id)),
                updatedBy: new ObjectId(String(this.reqUser.id)),
            }),
        };
    }

    /** @returns {object} Fields to merge on update */
    _auditUpdate() {
        return {
            updatedAt: getTimestamp(),
            ...(this.reqUser && {
                updatedBy: new ObjectId(String(this.reqUser.id)),
            }),
        };
    }

    /**
     * Resolves a projection arg (object or select string) into a plain object.
     * @param {object|string} [projection]
     * @returns {object}
     */
    _projection(projection) {
        if (!projection)                 return {};
        if (typeof projection === 'string') return selectToProject(projection);
        return projection;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INSERT
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Insert a single document. Adds audit fields automatically.
     * Alias: `create()`
     *
     * @param {object} data
     * @returns {Promise<object>} The inserted document (with `_id`).
     *
     * @example
     * const user = await users.insertOne({ name: 'Alice', email: 'a@a.com' });
     */
    async insertOne(data) {
        const doc = { ...data, ...this._auditCreate() };
        const { insertedId } = await this._col().insertOne(doc);
        return { _id: insertedId, ...doc };
    }

    /**
     * Alias for `insertOne`.
     * @param {object} data
     * @returns {Promise<object>}
     */
    async create(data) {
        return this.insertOne(data);
    }

    /**
     * Insert multiple documents at once.
     *
     * @param {object[]} docs
     * @param {object}   [options={}]             - Native driver InsertManyOptions.
     * @param {boolean}  [options.ordered=true]   - Stop on first error if true.
     * @returns {Promise<object[]>} The inserted documents (each with `_id`).
     *
     * @example
     * const inserted = await users.insertMany([
     *   { name: 'Alice' },
     *   { name: 'Bob'   },
     * ]);
     */
    async insertMany(docs, options = {}) {
        const audit   = this._auditCreate();
        const prepared = docs.map((d) => ({ ...d, ...audit }));
        const result   = await this._col().insertMany(prepared, options);

        return prepared.map((doc, i) => ({
            _id: result.insertedIds[i],
            ...doc,
        }));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FIND ONE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Find a document by its `_id`.
     *
     * @param {string|ObjectId}   id
     * @param {object|string}     [projection]  Object or select string.
     * @returns {Promise<object|null>}
     *
     * @example
     * const user = await users.findById('abc123');
     * const slim = await users.findById('abc123', '+name +email');
     */
    async findById(id, projection) {
        return this.findOne({ _id: new ObjectId(String(id)) }, { projection });
    }

    /**
     * Find a single document matching a filter.
     *
     * @param {object} filter
     * @param {object} [options={}]
     * @param {object|string} [options.projection]
     * @param {object} [options.sort]
     * @param {number} [options.skip]
     * @returns {Promise<object|null>}
     *
     * @example
     * const user = await users.findOne({ email: 'a@a.com' });
     */
    async findOne(filter, { projection, sort, skip } = {}) {
        return this._col().findOne(filter, {
            projection: this._projection(projection),
            ...(sort && { sort }),
            ...(skip !== undefined && { skip }),
        });
    }

    /**
     * Returns true if at least one document matches the filter.
     *
     * @param {object} filter
     * @returns {Promise<boolean>}
     *
     * @example
     * const taken = await users.exists({ email: 'a@a.com' });
     */
    async exists(filter) {
        const doc = await this._col().findOne(filter, { projection: { _id: 1 } });
        return doc !== null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FIND MANY
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Find documents with optional pagination.
     *
     * When `pagination` is `true` (default), returns:
     * `{ data, totalDocs, skip, limit, currentPage, totalPages, hasNextPage }`
     *
     * When `pagination` is `false`, returns a plain array.
     *
     * @param {object} filter
     * @param {object} [options={}]
     * @param {object|string} [options.projection]
     * @param {object}  [options.sort={ _id: 1 }]
     * @param {number}  [options.limit=50]
     * @param {number}  [options.skip=0]
     * @param {boolean} [options.pagination=true]
     * @returns {Promise<object>}
     *
     * @example
     * // Paginated
     * const result = await users.find({ active: true }, { limit: 20, skip: 0 });
     * // => { data: [...], totalDocs: 100, currentPage: 1, totalPages: 5, hasNextPage: true }
     *
     * // Plain array
     * const all = await users.find({ role: 'admin' }, { pagination: false });
     */
    async find(filter, {
        projection,
        sort       = { _id: 1 },
        limit      = 50,
        skip       = 0,
        pagination = true,
    } = {}) {
        const proj  = this._projection(projection);
        const query = this._col().find(filter).project(proj).sort(sort);

        if (!pagination) {
            return query.toArray();
        }

        const [totalDocs, data] = await Promise.all([
            this._col().countDocuments(filter),
            query.skip(skip).limit(limit).toArray(),
        ]);

        const currentPage = Math.floor(skip / limit) + 1;
        const totalPages  = Math.ceil(totalDocs / limit);

        return {
            data,
            totalDocs,
            skip,
            limit,
            currentPage,
            totalPages,
            hasNextPage: limit * currentPage < totalDocs,
        };
    }

    /**
     * Returns a raw MongoDB cursor for streaming large result sets.
     * You are responsible for closing it.
     *
     * @param {object} filter
     * @param {object} [options={}]
     * @param {object|string} [options.projection]
     * @param {object} [options.sort]
     * @returns {import('mongodb').FindCursor}
     *
     * @example
     * const cursor = users.getCursor({ active: true });
     * for await (const doc of cursor) { ... }
     * await cursor.close();
     */
    getCursor(filter, { projection, sort } = {}) {
        const query = this._col().find(filter).project(this._projection(projection));
        if (sort) query.sort(sort);
        return query;
    }

    /**
     * Get all distinct values of a field across the collection.
     *
     * @param {string} field
     * @param {object} [filter={}]
     * @returns {Promise<unknown[]>}
     *
     * @example
     * const roles = await users.distinct('role');
     * const tags  = await posts.distinct('tags', { published: true });
     */
    async distinct(field, filter = {}) {
        return this._col().distinct(field, filter);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  UPDATE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Find a document by `_id` and update it.
     * Returns the updated document.
     *
     * @param {string|ObjectId} id
     * @param {object}          updateObj        - MongoDB update operators e.g. `{ $set: {} }`.
     * @param {object[]}        [arrayFilters]   - Filters for positional array operators.
     * @param {object}          [options={}]     - Native driver options.
     * @returns {Promise<object|null>}
     *
     * @example
     * const updated = await users.findByIdAndUpdate('abc123', { $set: { role: 'admin' } });
     */
    async findByIdAndUpdate(id, updateObj, arrayFilters, options = {}) {
        return this.updateOne(
            { _id: new ObjectId(String(id)) },
            updateObj,
            arrayFilters,
            options,
        );
    }

    /**
     * Update a single document matching a filter.
     * Returns the updated document (`returnDocument: 'after'`).
     *
     * @param {object}   filter
     * @param {object}   updateObj       - MongoDB update operators.
     * @param {object[]} [arrayFilters]
     * @param {object}   [options={}]
     * @returns {Promise<object|null>}
     *
     * @example
     * const updated = await users.updateOne(
     *   { email: 'a@a.com' },
     *   { $set: { verified: true } },
     * );
     */
    async updateOne(filter, updateObj, arrayFilters, options = {}) {
        updateObj.$set = { ...this._auditUpdate(), ...updateObj.$set };

        return this._col().findOneAndUpdate(filter, updateObj, {
            upsert:         false,
            returnDocument: 'after',
            ...(arrayFilters?.length && { arrayFilters }),
            ...options,
        });
    }

    /**
     * Update all documents matching a filter.
     *
     * @param {object} filter
     * @param {object} updateObj
     * @returns {Promise<import('mongodb').UpdateResult>}
     *
     * @example
     * await users.updateMany({ plan: 'free' }, { $set: { trialExpired: true } });
     */
    async updateMany(filter, updateObj) {
        updateObj.$set = { ...this._auditUpdate(), ...updateObj.$set };
        return this._col().updateMany(filter, updateObj, { upsert: false });
    }

    /**
     * Find a document and replace it entirely.
     * Returns the new document.
     *
     * @param {object} filter
     * @param {object} replacement     - The new document (no update operators).
     * @param {object} [options={}]
     * @returns {Promise<object|null>}
     *
     * @example
     * const replaced = await users.findOneAndReplace(
     *   { _id: new ObjectId('abc123') },
     *   { name: 'Alice V2', email: 'v2@a.com' },
     * );
     */
    async findOneAndReplace(filter, replacement, options = {}) {
        const doc = { ...replacement, ...this._auditUpdate() };
        return this._col().findOneAndReplace(filter, doc, {
            returnDocument: 'after',
            ...options,
        });
    }

    /**
     * Replace a document matching a filter (no return value).
     *
     * @param {object} filter
     * @param {object} replacement
     * @param {object} [options={}]
     * @returns {Promise<import('mongodb').UpdateResult>}
     */
    async replaceOne(filter, replacement, options = {}) {
        const doc = { ...replacement, ...this._auditUpdate() };
        return this._col().replaceOne(filter, doc, options);
    }

    /**
     * Update a document if it exists, or insert it if it doesn't (upsert).
     * Returns the document after the operation.
     *
     * @param {object} filter
     * @param {object} updateObj
     * @param {object} [options={}]
     * @returns {Promise<object|null>}
     *
     * @example
     * const doc = await settings.upsert(
     *   { userId: 'abc123' },
     *   { $set: { theme: 'dark' }, $setOnInsert: { createdAt: getTimestamp() } },
     * );
     */
    async upsert(filter, updateObj, options = {}) {
        updateObj.$set = { ...this._auditUpdate(), ...updateObj.$set };

        return this._col().findOneAndUpdate(filter, updateObj, {
            upsert:         true,
            returnDocument: 'after',
            ...options,
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DELETE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Find a document by `_id` and delete it.
     * Returns the deleted document.
     *
     * @param {string|ObjectId} id
     * @returns {Promise<object|null>}
     *
     * @example
     * const deleted = await users.findByIdAndDelete('abc123');
     */
    async findByIdAndDelete(id) {
        return this.deleteOne({ _id: new ObjectId(String(id)) });
    }

    /**
     * Delete a single document matching a filter.
     * Returns the deleted document.
     *
     * @param {object} filter
     * @returns {Promise<object|null>}
     *
     * @example
     * const deleted = await users.deleteOne({ email: 'a@a.com' });
     */
    async deleteOne(filter) {
        return this._col().findOneAndDelete(filter);
    }

    /**
     * Delete all documents matching a filter.
     *
     * @param {object} filter
     * @returns {Promise<import('mongodb').DeleteResult>}
     *
     * @example
     * await sessions.deleteMany({ expiresAt: { $lt: getTimestamp() } });
     */
    async deleteMany(filter) {
        return this._col().deleteMany(filter);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  COUNT & CHECK
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Count documents matching a filter (exact, uses collection scan).
     *
     * @param {object} [filter={}]
     * @returns {Promise<number>}
     *
     * @example
     * const total = await users.countDocuments({ active: true });
     */
    async countDocuments(filter = {}) {
        return this._col().countDocuments(filter);
    }

    /**
     * Fast estimated count of all documents using collection metadata.
     * Does NOT accept a filter — use `countDocuments` for filtered counts.
     *
     * @returns {Promise<number>}
     *
     * @example
     * const approx = await users.estimatedCount();
     */
    async estimatedCount() {
        return this._col().estimatedDocumentCount();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  AGGREGATION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Run an aggregation pipeline.
     *
     * @param {object[]} pipeline
     * @param {object}   [options={}]  - Native driver AggregateOptions.
     * @returns {Promise<object[]>}
     *
     * @example
     * const stats = await orders.aggregate([
     *   { $match: { status: 'paid' } },
     *   { $group: { _id: '$userId', total: { $sum: '$amount' } } },
     *   { $sort: { total: -1 } },
     * ]);
     */
    async aggregate(pipeline = [], options = {}) {
        return this._col().aggregate(pipeline, options).toArray();
    }

    /**
     * Group documents by a field and optionally run an accumulator.
     * A convenience wrapper around a simple `$group` aggregation.
     *
     * @param {string} field                      - Field to group by.
     * @param {object} [accumulators={}]          - Additional `$group` accumulators.
     * @param {object} [matchFilter={}]           - Optional `$match` before grouping.
     * @returns {Promise<object[]>}               - Each item: `{ _id, count, ...accumulators }`
     *
     * @example
     * // Count users per role
     * const result = await users.groupBy('role');
     * // => [{ _id: 'admin', count: 3 }, { _id: 'user', count: 97 }]
     *
     * // Total revenue per product with a pre-filter
     * const result = await orders.groupBy(
     *   'productId',
     *   { revenue: { $sum: '$amount' } },
     *   { status: 'paid' },
     * );
     */
    async groupBy(field, accumulators = {}, matchFilter = {}) {
        const pipeline = [
            ...(Object.keys(matchFilter).length ? [{ $match: matchFilter }] : []),
            {
                $group: {
                    _id:   `$${field}`,
                    count: { $sum: 1 },
                    ...accumulators,
                },
            },
        ];
        return this.aggregate(pipeline);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  BULK OPERATIONS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Perform mixed bulk write operations (insertOne, updateOne, deleteOne, etc.).
     *
     * @param {object[]} operations  - Array of bulk write operation objects.
     * @param {object}   [options={}]
     * @returns {Promise<import('mongodb').BulkWriteResult>}
     *
     * @example
     * await users.bulkWrite([
     *   { insertOne:  { document: { name: 'Alice' } } },
     *   { updateOne:  { filter: { _id: id }, update: { $set: { active: false } } } },
     *   { deleteOne:  { filter: { _id: oldId } } },
     * ]);
     */
    async bulkWrite(operations, options = {}) {
        return this._col().bulkWrite(operations, options);
    }

    /**
     * Efficiently upsert many documents in a single round-trip.
     * Each document must have a unique field to match on.
     *
     * @param {object[]} docs          - Documents to upsert.
     * @param {string}   matchField    - Field used as the match key (e.g. '_id', 'email').
     * @returns {Promise<import('mongodb').BulkWriteResult>}
     *
     * @example
     * await products.bulkUpsert(productsArray, 'sku');
     */
    async bulkUpsert(docs, matchField = '_id') {
        const audit = this._auditUpdate();
        const ops = docs.map((doc) => ({
            updateOne: {
                filter: { [matchField]: doc[matchField] },
                update: {
                    $set:         { ...doc, ...audit },
                    $setOnInsert: { createdAt: audit.updatedAt },
                },
                upsert: true,
            },
        }));
        return this._col().bulkWrite(ops, { ordered: false });
    }

    /**
     * Delete all documents matching a filter using an unordered bulk operation.
     * More efficient than `deleteMany` for large sets.
     *
     * @param {object} filter
     * @returns {Promise<import('mongodb').BulkWriteResult>}
     *
     * @example
     * await logs.bulkDelete({ createdAt: { $lt: cutoff } });
     */
    async bulkDelete(filter) {
        const bulk = this._col().initializeUnorderedBulkOp();
        bulk.find(filter).delete();
        return bulk.execute();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INDEXES
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Create a single index on the collection.
     *
     * @param {object} keyPattern    - Index key pattern e.g. `{ email: 1 }`.
     * @param {object} [options={}]  - Index options (unique, sparse, expireAfterSeconds, etc.).
     * @returns {Promise<string>}    - The name of the created index.
     *
     * @example
     * await users.createIndex({ email: 1 }, { unique: true });
     * await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
     */
    async createIndex(keyPattern, options = {}) {
        return this._col().createIndex(keyPattern, options);
    }

    /**
     * Create multiple indexes at once.
     *
     * @param {object[]} indexes  - Array of `{ key, ...options }` objects.
     * @returns {Promise<string[]>}
     *
     * @example
     * await users.createIndexes([
     *   { key: { email: 1 },    unique: true },
     *   { key: { createdAt: -1 }             },
     * ]);
     */
    async createIndexes(indexes) {
        return this._col().createIndexes(indexes);
    }

    /**
     * Drop an index by name or key pattern.
     *
     * @param {string|object} indexNameOrSpec
     * @returns {Promise<object>}
     *
     * @example
     * await users.dropIndex('email_1');
     * await users.dropIndex({ email: 1 });
     */
    async dropIndex(indexNameOrSpec) {
        return this._col().dropIndex(indexNameOrSpec);
    }

    /**
     * Drop all indexes except `_id`.
     *
     * @returns {Promise<object>}
     */
    async dropIndexes() {
        return this._col().dropIndexes();
    }

    /**
     * List all indexes on the collection.
     *
     * @returns {Promise<object[]>}
     *
     * @example
     * const indexes = await users.listIndexes();
     */
    async listIndexes() {
        return this._col().listIndexes().toArray();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CHANGE STREAMS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Open a change stream to watch for real-time changes on the collection.
     * Remember to close the stream when done.
     *
     * @param {object[]} [pipeline=[]]  - Optional aggregation pipeline to filter events.
     * @param {object}   [options={}]   - Native driver ChangeStreamOptions.
     * @returns {import('mongodb').ChangeStream}
     *
     * @example
     * const stream = users.watch([{ $match: { 'fullDocument.role': 'admin' } }]);
     *
     * stream.on('change', (event) => {
     *   console.log('Change detected:', event);
     * });
     *
     * // Later — always close when done
     * await stream.close();
     */
    watch(pipeline = [], options = {}) {
        return this._col().watch(pipeline, options);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TRANSACTIONS (session helpers)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Run a set of operations inside a MongoDB transaction.
     * Automatically commits on success and aborts on error.
     *
     * Requires a replica set or sharded cluster.
     *
     * @param {(session: import('mongodb').ClientSession) => Promise<T>} fn
     * @returns {Promise<T>}
     *
     * @example
     * const result = await orders.withTransaction(async (session) => {
     *   const order = await orders.insertOne({ userId, total }, { session });
     *   await inventory.updateOne(
     *     { productId },
     *     { $inc: { stock: -1 } },
     *     undefined,
     *     { session },
     *   );
     *   return order;
     * });
     */
    async withTransaction(fn) {
        // Access the underlying MongoClient through the collection
        const client = this._col().s?.db?.client ?? this._col().client;
        const session = client.startSession();
        try {
            let result;
            await session.withTransaction(async () => {
                result = await fn(session);
            });
            return result;
        } finally {
            await session.endSession();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  UTILITIES
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Convert a string to an ObjectId.
     * Handy for building filters without importing ObjectId directly.
     *
     * @param {string} id
     * @returns {ObjectId}
     *
     * @example
     * const oid = users.toObjectId('abc123');
     */
    toObjectId(id) {
        return new ObjectId(String(id));
    }

    /**
     * Check whether a string is a valid ObjectId.
     *
     * @param {string} id
     * @returns {boolean}
     *
     * @example
     * users.isValidObjectId('abc123')   // false
     * users.isValidObjectId('64c9f...')  // true
     */
    isValidObjectId(id) {
        return ObjectId.isValid(id);
    }

    /**
     * Return the raw MongoDB `Collection` instance for any operation
     * not covered by DataLayer.
     *
     * @returns {import('mongodb').Collection}
     *
     * @example
     * const col = users.getCollection();
     * await col.findOneAndReplace(...);
     */
    getCollection() {
        return this._col();
    }
}

export default DataLayer;