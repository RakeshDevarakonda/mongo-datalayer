import { MongoClient } from 'mongodb';

// ─── Singleton state ──────────────────────────────────────────────────────────

/** @type {MongoClient | null} */
let client = null;

/** @type {import('mongodb').Db | null} */
let db = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connect to MongoDB. Call this **once** at app startup.
 * Calling it a second time is a safe no-op.
 *
 * @param {string} uri - MongoDB connection string.
 * @param {object} options
 * @param {string} options.databaseName        - Database to use.
 * @param {number} [options.maxPoolSize=10]    - Max connections in the pool.
 * @param {number} [options.minPoolSize=2]     - Min connections in the pool.
 * @returns {Promise<void>}
 *
 * @example
 * import { connect } from 'mongo-datalayer';
 * await connect(process.env.MONGODB_URI, { databaseName: 'myapp' });
 */
export async function connect(uri, { databaseName, maxPoolSize = 10, minPoolSize = 2 } = {}) {
    if (client) return; // already connected

    if (!uri)          throw new Error('[mongo-datalayer] connect() requires a MongoDB URI.');
    if (!databaseName) throw new Error('[mongo-datalayer] connect() requires a databaseName.');

    client = new MongoClient(uri, { maxPoolSize, minPoolSize });
    await client.connect();
    db = client.db(databaseName);
}

/**
 * Disconnect from MongoDB.
 * Safe to call even if not connected.
 *
 * @returns {Promise<void>}
 *
 * @example
 * import { disconnect } from 'mongo-datalayer';
 * process.on('SIGTERM', disconnect);
 */
export async function disconnect() {
    if (client) {
        await client.close();
        client = null;
        db     = null;
    }
}

/**
 * Returns whether a connection is currently open.
 *
 * @returns {boolean}
 */
export function isConnected() {
    return client !== null && db !== null;
}

/**
 * Returns the active `Db` instance.
 * Throws a clear error if `connect()` has not been called.
 *
 * @returns {import('mongodb').Db}
 */
export function getDb() {
    if (!db) {
        throw new Error(
            '[mongo-datalayer] No connection. Call connect(uri, { databaseName }) before using DataLayer.',
        );
    }
    return db;
}

/**
 * Returns a MongoDB `Collection` by name.
 *
 * @param {string} name
 * @returns {import('mongodb').Collection}
 */
export function getCollection(name) {
    return getDb().collection(name);
}