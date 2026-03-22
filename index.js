// ─── Core ─────────────────────────────────────────────────────────────────────
export { connect, getDb, getCollection, disconnect, isConnected } from './config/mongodb.js';
export { default as DataLayer } from './service/datalayer.js';

// ─── Optional: Document tracking ─────────────────────────────────────────────
export { default as TrackedDataLayer }                              from './service/TrackedDataLayer.js';
export { configureTracker }                                         from './service/tracker.js';
export { getHistory, getLastChange, restoreDocument, compareDiff }  from './service/history.js';
