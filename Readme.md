# mongo-datalayer

A zero-boilerplate MongoDB data layer for Node.js.  
Connect once, use everywhere — full CRUD, automatic audit stamps, built-in pagination, populate, and optional document history tracking.

---

## Table of Contents

- [Install](#install)
- [Two ways to use](#two-ways-to-use)
- [Connect](#connect)
- [DataLayer](#datalayer)
  - [Create](#create)
  - [Read](#read)
  - [Update](#update)
  - [Delete](#delete)
  - [Count](#count)
  - [Aggregation](#aggregation)
  - [Bulk operations](#bulk-operations)
  - [Populate](#populate)
  - [Indexes](#indexes)
  - [Change streams](#change-streams)
  - [Transactions](#transactions)
  - [Utilities](#utilities)
- [TrackedDataLayer](#trackeddatalayer) *(optional)*
  - [Setup](#setup)
  - [Options](#options)
  - [Storage modes](#storage-modes)
  - [Track specific fields](#track-specific-fields)
  - [Track specific operations](#track-specific-operations)
  - [Custom fields meta](#custom-fields-meta)
  - [maxHistory vs archiveAfter](#maxhistory-vs-archiveafter)
  - [Query history](#query-history)
- [Graceful shutdown](#graceful-shutdown)
- [Why not Mongoose?](#why-not-mongoose)

---

## Two ways to use (Recommended option-2)

### Option 1 — Import directly from the package

```bash
npm install mongo-datalayer mongodb
```

```js
// DataLayer only
import { connect, DataLayer } from 'mongo-datalayer';

// DataLayer + TrackedDataLayer + history functions
import { connect, DataLayer, TrackedDataLayer, configureTracker, getHistory, getLastChange, restoreDocument, compareDiff } from 'mongo-datalayer';
```

---

### Option 2 — Copy files into your project *(recommended)*

Copy the source files directly into your project so you own and can edit the code freely.

**DataLayer only:**

```bash
npx mongo-datalayer init
```

Creates:

```
your-project/
├── config/
│   └── mongodb.js         ← singleton client
└── service/
    └── datalayer.js       ← DataLayer class (helpers built-in)
```

Import from your own files:

```js
import { connect, disconnect } from './config/mongodb.js';
import DataLayer              from './service/datalayer.js';
```

---

**DataLayer + TrackedDataLayer:**

```bash
npx mongo-datalayer init --tracker
```

Creates:

```
your-project/
├── config/
│   └── mongodb.js              ← singleton client
├── service/
│   ├── datalayer.js            ← DataLayer class (helpers built-in)
│   ├── TrackedDataLayer.js     ← history tracking class
│   ├── tracker.js              ← tracker engine (diff, global config)
│   └── history.js              ← getHistory, getLastChange, restoreDocument, compareDiff
```

Import from your own files:

```js
import { connect, disconnect }  from './config/mongodb.js';
import DataLayer                from './service/datalayer.js';
import TrackedDataLayer         from './service/TrackedDataLayer.js';
import { configureTracker }     from './service/tracker.js';
import { getHistory, getLastChange, restoreDocument, compareDiff } from './service/history.js';
```

> Run with `--force` to overwrite existing files:
> ```bash
> npx mongo-datalayer init --force
> npx mongo-datalayer init --tracker --force
> ```

---

## Connect

Call once at app startup — every `DataLayer` and `TrackedDataLayer` instance shares the same client automatically.

```js
import { connect } from 'mongo-datalayer';

await connect(process.env.MONGODB_URI, {
    databaseName: 'myapp',   // required
    maxPoolSize:  10,         // default 10
    minPoolSize:  2,          // default 2
});
```

---

## DataLayer

Create a `DataLayer` instance per collection.  
Pass the logged-in user as the second argument to get automatic `createdBy` / `updatedBy` / `createdAt` / `updatedAt` audit stamps.

```js
import { DataLayer } from 'mongo-datalayer';

const users = new DataLayer('users');            // no audit stamps
const posts = new DataLayer('posts', req.user);  // adds createdBy / updatedBy
```

Every document automatically gets:

```js
{
    createdAt: 1712000000,       // unix timestamp — added on insert
    updatedAt: 1712000000,       // unix timestamp — updated on every write
    createdBy: ObjectId('...'),  // only if req.user passed
    updatedBy: ObjectId('...'),  // only if req.user passed — updated on every write
}
```

---

## Create

### insertOne / create

Inserts a single document. Returns the full document including `_id` and audit stamps.

```js
const user = await users.insertOne({
    name:     'Alice',
    email:    'alice@example.com',
    role:     'user',
    password: 'hashed_pw',
});

// Returns:
// {
//     _id:       ObjectId('64a1f...'),
//     name:      'Alice',
//     email:     'alice@example.com',
//     role:      'user',
//     password:  'hashed_pw',
//     createdAt: 1712000000,
//     updatedAt: 1712000000,
// }

// create() is an alias for insertOne()
const user = await users.create({ name: 'Alice', email: 'alice@example.com', role: 'user' });
```

### insertMany

Inserts multiple documents. Returns an array of all inserted documents with `_id`.

```js
const inserted = await users.insertMany([
    { name: 'Bob',     email: 'bob@example.com',     role: 'user'  },
    { name: 'Charlie', email: 'charlie@example.com', role: 'admin' },
]);

// Returns:
// [
//     { _id: ObjectId('...'), name: 'Bob',     role: 'user',  createdAt: ..., updatedAt: ... },
//     { _id: ObjectId('...'), name: 'Charlie', role: 'admin', createdAt: ..., updatedAt: ... },
// ]
```

---

## Read

### findById

Find a document by its `_id`.

```js
// All fields
const user = await users.findById('64a1f...');
// { _id: ObjectId('...'), name: 'Alice', email: '...', role: 'user', password: '...', ... }

// Exclude fields — string syntax
const user = await users.findById('64a1f...', '-password -age');
// { _id: ObjectId('...'), name: 'Alice', email: '...', role: 'user' }

// Include fields — string syntax
const user = await users.findById('64a1f...', 'name email role');
// { _id: ObjectId('...'), name: 'Alice', email: '...', role: 'user' }

// Explicit include — string syntax with +
const user = await users.findById('64a1f...', '+name +email');
// { _id: ObjectId('...'), name: 'Alice', email: '...' }

// Object projection (MongoDB native syntax)
const user = await users.findById('64a1f...', { name: 1, email: 1 });
// { _id: ObjectId('...'), name: 'Alice', email: '...' }

// Returns null if not found
const user = await users.findById('000000000000000000000000');
// null
```

### findOne

Find the first document matching a filter.

```js
// Basic
const user = await users.findOne({ email: 'alice@example.com' });
// { _id: ObjectId('...'), name: 'Alice', email: '...', role: 'user', ... }

// With projection — object syntax
const user = await users.findOne(
    { email: 'alice@example.com' },
    { projection: { name: 1, email: 1 } },
);
// { _id: ObjectId('...'), name: 'Alice', email: '...' }

// With projection — string syntax
const user = await users.findOne(
    { email: 'alice@example.com' },
    { projection: '-password -createdAt' },
);

// With sort — get latest admin
const latest = await users.findOne(
    { role: 'admin' },
    { sort: { createdAt: -1 } },
);

// With sort and skip
const second = await users.findOne(
    { role: 'user' },
    { sort: { createdAt: -1 }, skip: 1 },
);

// Returns null if not found
const user = await users.findOne({ email: 'notfound@example.com' });
// null
```

### find — paginated (default)

Returns `{ data, totalDocs, skip, limit, currentPage, totalPages, hasNextPage }`.

```js
// Basic paginated
const result = await users.find({ role: 'user' }, { limit: 20, skip: 0 });
// {
//     data:        [ { _id: ..., name: 'Alice', ... }, ... ],
//     totalDocs:   100,
//     skip:        0,
//     limit:       20,
//     currentPage: 1,
//     totalPages:  5,
//     hasNextPage: true,
// }

// Page 2
const result = await users.find({ role: 'user' }, { limit: 20, skip: 20 });
// { currentPage: 2, hasNextPage: true, ... }

// Last page
const result = await users.find({ role: 'user' }, { limit: 20, skip: 80 });
// { currentPage: 5, hasNextPage: false, ... }

// With sort — newest first
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0, sort: { createdAt: -1 } },
);

// With projection — object (include specific fields)
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0, projection: { name: 1, email: 1 } },
);
// data: [ { _id: ..., name: 'Alice', email: '...' }, ... ]

// With projection — string include
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0, projection: 'name email role' },
);

// With projection — string exclude
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0, projection: '-password -age' },
);

// With projection — string mixed (include + exclude)
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0, projection: 'name email -password' },
);

// All options together
const result = await users.find(
    { active: true },
    {
        limit:      20,
        skip:       0,
        sort:       { createdAt: -1 },
        projection: '-password -__v',
    },
);

// Reading the paginated result
console.log(result.data);         // array of documents for this page
console.log(result.totalDocs);    // total documents matching the filter
console.log(result.currentPage);  // 1-based page number
console.log(result.totalPages);   // total number of pages
console.log(result.hasNextPage);  // true if more pages exist
console.log(result.skip);         // skip value used
console.log(result.limit);        // limit value used
```

**Projection string syntax:**

| Syntax | Meaning |
|---|---|
| `"name email"` | include only name and email |
| `"+name +email"` | include (explicit `+`) — same result |
| `"-password"` | exclude password |
| `"-password -age"` | exclude multiple fields |
| `"name -password"` | include name, exclude password |

### find — plain array (no pagination)

```js
// All documents — plain array
const all = await users.find({}, { pagination: false });
// [ { _id: ..., name: 'Alice', ... }, { _id: ..., name: 'Bob', ... } ]

// With filter
const admins = await users.find({ role: 'admin' }, { pagination: false });
// [ { _id: ..., name: 'Charlie', role: 'admin', ... } ]

// With projection
const slim = await users.find(
    { active: true },
    { pagination: false, projection: 'name email role' },
);
// [ { _id: ..., name: 'Alice', email: '...', role: 'user' }, ... ]

// With sort
const sorted = await users.find(
    {},
    { pagination: false, sort: { name: 1 }, projection: '-password' },
);
```

### exists

Lightweight check — only fetches `_id`, does not load the full document.

```js
const taken = await users.exists({ email: 'alice@example.com' });
// true

const taken = await users.exists({ email: 'notfound@example.com' });
// false

// Any filter works
const hasAdmins = await users.exists({ role: 'admin' });
// true
```

### distinct

Get all unique values for a field across the collection.

```js
const roles = await users.distinct('role');
// [ 'admin', 'user' ]

// With filter
const activeRoles = await users.distinct('role', { active: true });
// [ 'user' ]

// On any field
const countries = await users.distinct('address.country');
// [ 'IN', 'US', 'GB' ]
```

### getCursor

Raw MongoDB cursor — use for streaming large datasets without loading everything into memory.

```js
const cursor = users.getCursor({ active: true });

for await (const doc of cursor) {
    console.log(doc);
}

// Always close when done
await cursor.close();

// With projection and sort
const cursor = users.getCursor(
    { active: true },
    { projection: 'name email', sort: { createdAt: -1 } },
);

for await (const doc of cursor) {
    await sendEmail(doc.email);
}
await cursor.close();
```

---

## Update

### findByIdAndUpdate

Find by `_id`, apply update operators, return the **updated** document.

```js
// $set — update specific fields
const updated = await users.findByIdAndUpdate('64a1f...', {
    $set: { role: 'admin', name: 'Bob' },
});
// { _id: ..., name: 'Bob', role: 'admin', updatedAt: 1712000001, ... }

// $inc — increment a number field
const updated = await users.findByIdAndUpdate('64a1f...', {
    $inc: { loginCount: 1 },
});
// { loginCount: 6, updatedAt: ..., ... }

// $push — append to an array
const updated = await users.findByIdAndUpdate('64a1f...', {
    $push: { tags: 'vip' },
});
// { tags: ['nodejs', 'vip'], ... }

// $pull — remove from an array
const updated = await users.findByIdAndUpdate('64a1f...', {
    $pull: { tags: 'vip' },
});
// { tags: ['nodejs'], ... }

// $unset — remove a field entirely
const updated = await users.findByIdAndUpdate('64a1f...', {
    $unset: { temporaryToken: '' },
});

// Multiple operators at once
const updated = await users.findByIdAndUpdate('64a1f...', {
    $set:  { role: 'admin' },
    $inc:  { loginCount: 1 },
    $push: { tags: 'promoted' },
});

// Returns null if not found
const updated = await users.findByIdAndUpdate('000000000000000000000000', {
    $set: { role: 'admin' },
});
// null
```

### updateOne

Find first matching document, update it, return the **updated** document.

```js
const updated = await users.updateOne(
    { email: 'alice@example.com' },
    { $set: { verified: true } },
);
// { _id: ..., email: '...', verified: true, updatedAt: ..., ... }

// Returns null if not found
const updated = await users.updateOne(
    { email: 'notfound@example.com' },
    { $set: { verified: true } },
);
// null
```

### updateOne with arrayFilters

Update specific elements inside a nested array.

```js
// Approve a specific comment inside a post
const updated = await posts.findByIdAndUpdate(
    postId,
    { $set: { 'comments.$[c].approved': true } },
    [{ 'c._id': new ObjectId(commentId) }],
);

// Update a specific item in an order's items array
const updated = await orders.findByIdAndUpdate(
    orderId,
    { $set: { 'items.$[i].shipped': true } },
    [{ 'i.productId': new ObjectId(productId) }],
);
```

### updateMany

Update all documents matching a filter. Returns MongoDB `UpdateResult`.

```js
const result = await users.updateMany(
    { plan: 'free' },
    { $set: { trialExpired: true } },
);
// { matchedCount: 50, modifiedCount: 50, acknowledged: true }

// Bulk flag all inactive users
const result = await users.updateMany(
    { lastSeen: { $lt: sixMonthsAgo } },
    { $set: { inactive: true } },
);
```

### upsert

Update if exists, insert if not. Returns the document after the operation.

```js
// Update if found, insert if not
const doc = await settings.upsert(
    { userId: 'abc123' },
    { $set: { theme: 'dark', lang: 'en' } },
);
// Existing → updated doc returned
// Not found → newly inserted doc returned

// Common use case — device registration
const device = await devices.upsert(
    { deviceId: req.headers['x-device-id'] },
    { $set: { lastSeen: getTimestamp(), userId: req.user.id } },
);
```

### findOneAndReplace / replaceOne

Replace the entire document body (no update operators — completely replaces all fields).

```js
// findOneAndReplace — returns the new document
const replaced = await users.findOneAndReplace(
    { _id: id },
    { name: 'Alice V2', email: 'v2@example.com', role: 'admin' },
);
// { _id: ..., name: 'Alice V2', email: '...', updatedAt: ... }

// replaceOne — returns UpdateResult, no document
const result = await users.replaceOne(
    { _id: id },
    { name: 'Alice V2', email: 'v2@example.com', role: 'admin' },
);
// { matchedCount: 1, modifiedCount: 1, acknowledged: true }
```

---

## Delete

### findByIdAndDelete

Find by `_id`, delete it, return the **deleted** document.

```js
const deleted = await users.findByIdAndDelete('64a1f...');
// { _id: ..., name: 'Alice', email: '...', role: 'user', ... }

// Returns null if not found
const deleted = await users.findByIdAndDelete('000000000000000000000000');
// null
```

### deleteOne

Find first matching document, delete it, return the **deleted** document.

```js
const deleted = await users.deleteOne({ email: 'spam@example.com' });
// { _id: ..., name: '...', email: 'spam@example.com', ... }

// Returns null if not found
const deleted = await users.deleteOne({ email: 'notfound@example.com' });
// null
```

### deleteMany

Delete all matching documents. Returns MongoDB `DeleteResult`.

```js
const result = await users.deleteMany({ archived: true });
// { deletedCount: 12, acknowledged: true }

// Delete all expired sessions
const result = await sessions.deleteMany({ expiresAt: { $lt: getTimestamp() } });
// { deletedCount: 530, acknowledged: true }

// Delete all (use with caution)
const result = await tempData.deleteMany({});
// { deletedCount: 100, acknowledged: true }
```

### bulkDelete

Efficient unordered bulk delete — better for large sets.

```js
const result = await logs.bulkDelete({ createdAt: { $lt: cutoff } });
// { nRemoved: 5000, ok: 1 }
```

---

## Count

### countDocuments

Exact count with filter — uses a collection scan.

```js
const count = await users.countDocuments({ role: 'user' });
// 97

const total = await users.countDocuments({});
// 100

const active = await users.countDocuments({ active: true, role: 'admin' });
// 3
```

### estimatedCount

Fast approximate total — uses collection metadata, no filter supported.

```js
const approx = await users.estimatedCount();
// 100  (fast — reads metadata, no scan)
```

---

## Aggregation

### aggregate

Run a full MongoDB aggregation pipeline. Returns an array.

```js
// Revenue per user
const stats = await orders.aggregate([
    { $match: { status: 'paid' } },
    { $group: { _id: '$userId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort:  { total: -1 } },
    { $limit: 10 },
]);
// [ { _id: ObjectId('...'), total: 5400, count: 12 }, ... ]

// Average order value per month
const monthly = await orders.aggregate([
    { $group: {
        _id:   { $month: { $toDate: { $multiply: ['$createdAt', 1000] } } },
        avg:   { $avg: '$amount' },
        count: { $sum: 1 },
    }},
    { $sort: { '_id': 1 } },
]);
```

### groupBy

Convenience shorthand for a common `$group` + optional `$match` pipeline.

```js
// Count per role
const byRole = await users.groupBy('role');
// [ { _id: 'admin', count: 3 }, { _id: 'user', count: 97 } ]

// With accumulators
const revenue = await orders.groupBy(
    'productId',
    { total: { $sum: '$amount' }, avg: { $avg: '$amount' }, orders: { $sum: 1 } },
);
// [ { _id: ObjectId('...'), count: 10, total: 5400, avg: 540, orders: 10 }, ... ]

// With pre-filter
const paidRevenue = await orders.groupBy(
    'productId',
    { total: { $sum: '$amount' } },
    { status: 'paid' },   // only paid orders
);
```

---

## Bulk operations

### bulkWrite

Perform mixed operations in a single round-trip.

```js
const result = await users.bulkWrite([
    { insertOne:  { document: { name: 'Dave', role: 'user' } } },
    { updateOne:  { filter: { _id: id1 }, update: { $set: { active: true } } } },
    { updateMany: { filter: { role: 'guest' }, update: { $set: { expired: true } } } },
    { deleteOne:  { filter: { _id: oldId } } },
]);
// { insertedCount: 1, modifiedCount: 6, deletedCount: 1, ok: 1 }
```

### bulkUpsert

Upsert many documents in one round-trip using a match field.

```js
// Match and upsert by 'sku'
await products.bulkUpsert(productsArray, 'sku');

// Match and upsert by 'email'
await users.bulkUpsert(usersArray, 'email');

// Default match field is '_id'
await users.bulkUpsert(usersArray);
```

---

## Populate

Resolve ObjectId references to full documents from other collections. Uses MongoDB `$lookup` under the hood.

### Population config options

| Option | Type | Default | Description |
|---|---|---|---|
| `field` | string | required | Local field on this collection holding the ObjectId(s) |
| `collection` | string | required | Foreign collection to join |
| `foreignField` | string | `'_id'` | Field on the foreign collection to match against |
| `as` | string | same as `field` | Output field name in the result |
| `projection` | object | none | Fields to include/exclude from joined documents |
| `filter` | object | none | Extra filter applied to joined documents |
| `array` | boolean | `false` | `true` if local field holds an array of ObjectIds |

### Query options

| Option | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max documents per page |
| `skip` | number | `0` | Documents to skip |
| `sort` | object | `{ _id: 1 }` | Sort order |
| `pagination` | boolean | `true` | `false` returns a plain array |
| `projection` | string/object | none | Fields to include/exclude from the final output document |

---

### Basic — single reference

```js
// posts: { title, authorId: ObjectId → users._id }

const result = await posts.populate(
    { published: true },
    [
        {
            field:      'authorId',   // local field
            collection: 'users',      // foreign collection
            // foreignField defaults to '_id'
            // as defaults to 'authorId'
        },
    ],
    { limit: 10, skip: 0 },
);

// result.data[0]:
// {
//     _id:      ObjectId('...'),
//     title:    'Hello World',
//     authorId: { _id: ObjectId('...'), name: 'Alice', email: '...', role: 'user' },
// }
```

---

### foreignField — match on a field other than _id

```js
// orders: { total, userEmail: 'alice@example.com' → users.email }

const result = await orders.populate(
    { status: 'paid' },
    [
        {
            field:        'userEmail',   // orders.userEmail
            foreignField: 'email',       // match against users.email (not _id)
            collection:   'users',
        },
    ],
);

// result.data[0]:
// {
//     total:     500,
//     userEmail: { _id: ..., name: 'Alice', email: 'alice@example.com', ... },
// }
```

---

### as — rename the output field

```js
const result = await orders.populate(
    { status: 'paid' },
    [
        {
            field:      'userId',
            collection: 'users',
            as:         'customer',   // output as 'customer' instead of 'userId'
        },
        {
            field:      'productId',
            collection: 'products',
            as:         'product',    // output as 'product' instead of 'productId'
        },
    ],
);

// result.data[0]:
// {
//     total:     500,
//     userId:    ObjectId('...'),              ← original field still present
//     productId: ObjectId('...'),              ← original field still present
//     customer:  { _id: ..., name: 'Alice' }, ← populated into 'customer'
//     product:   { _id: ..., title: 'Book' }, ← populated into 'product'
// }
```

---

### projection — only fetch specific fields from joined collection

```js
const result = await orders.populate(
    { status: 'paid' },
    [
        {
            field:      'userId',
            collection: 'users',
            as:         'customer',
            projection: { name: 1, email: 1 },      // password NOT fetched
        },
        {
            field:      'productId',
            collection: 'products',
            as:         'product',
            projection: { title: 1, price: 1, sku: 1 },
        },
    ],
);

// result.data[0]:
// {
//     customer: { _id: ..., name: 'Alice', email: '...' },
//     product:  { _id: ..., title: 'Book', price: 500, sku: 'SKU-001' },
// }
```

---

### filter — extra condition on joined documents

```js
// Only populate if the joined user is active — null if inactive
const result = await orders.populate(
    { status: 'paid' },
    [
        {
            field:      'userId',
            collection: 'users',
            as:         'customer',
            filter:     { active: true, verified: true },
        },
    ],
);

// result.data[0] when user is active:
// { customer: { _id: ..., name: 'Alice', active: true } }

// result.data[0] when user is inactive:
// { customer: null }
```

---

### array: true — field holds an array of ObjectIds

```js
// posts: { title, tagIds: [ObjectId('t1'), ObjectId('t2'), ObjectId('t3')] }

const result = await posts.populate(
    { published: true },
    [
        {
            field:      'tagIds',
            collection: 'tags',
            array:      true,               // keep result as array — skip $unwind
            projection: { name: 1, color: 1 },
        },
    ],
);

// result.data[0].tagIds:
// [
//     { _id: ObjectId('t1'), name: 'mongodb', color: 'green' },
//     { _id: ObjectId('t2'), name: 'nodejs',  color: 'blue'  },
//     { _id: ObjectId('t3'), name: 'express', color: 'gray'  },
// ]
```

---

### All options together — one population

```js
const result = await orders.populate(
    { status: 'paid' },
    [
        {
            field:        'userEmail',                          // local field
            foreignField: 'email',                             // match users.email
            collection:   'users',
            as:           'customer',                          // rename output
            projection:   { name: 1, email: 1, plan: 1 },     // only these fields
            filter:       { active: true, verified: true },    // only active+verified
            array:        false,                               // single object result
        },
    ],
    {
        limit:      20,
        skip:       0,
        sort:       { createdAt: -1 },
        pagination: true,
        projection: '-__v',   // exclude from final order document
    },
);

// result:
// {
//     data: [
//         {
//             _id:       ObjectId('...'),
//             total:     500,
//             status:    'paid',
//             userEmail: 'alice@example.com',
//             customer:  { _id: ..., name: 'Alice', email: '...', plan: 'pro' },
//         },
//         ...
//     ],
//     totalDocs:   100,
//     currentPage: 1,
//     totalPages:  5,
//     hasNextPage: true,
// }
```

---

### Multiple populations — all options, plain array

```js
const all = await orders.populate(
    { createdAt: { $gte: 1712000000 } },
    [
        {
            field:        'userId',
            foreignField: '_id',
            collection:   'users',
            as:           'customer',
            projection:   { name: 1, email: 1 },
            filter:       { active: true },
            array:        false,
        },
        {
            field:        'productId',
            foreignField: '_id',
            collection:   'products',
            as:           'product',
            projection:   { title: 1, price: 1, stock: 1 },
            array:        false,
        },
        {
            field:        'tagIds',
            foreignField: '_id',
            collection:   'tags',
            as:           'tags',
            projection:   { name: 1, color: 1 },
            array:        true,   // tagIds is an array of ObjectIds
        },
    ],
    {
        pagination: false,          // plain array
        sort:       { total: -1 },
        projection: '-__v',
    },
);

// all (plain array):
// [
//     {
//         total:    1000,
//         customer: { _id: ..., name: 'Alice', email: '...' },
//         product:  { _id: ..., title: 'Book', price: 500, stock: 10 },
//         tags:     [ { name: 'sale', color: 'red' }, { name: 'new', color: 'green' } ],
//     },
//     ...
// ]
```
## Indexes

```js
// Unique index — prevent duplicate emails
await users.createIndex({ email: 1 }, { unique: true });

// TTL index — auto-delete expired sessions
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index — optimise queries filtering by userId + sort by createdAt
await orders.createIndex({ userId: 1, createdAt: -1 });

// Text index — full-text search
await products.createIndex({ name: 'text', description: 'text' });

// Multiple indexes at once
await users.createIndexes([
    { key: { email: 1 },          unique: true },
    { key: { createdAt: -1 } },
    { key: { role: 1, active: 1 } },
]);

// List all indexes on a collection
const indexes = await users.listIndexes();
// [ { name: '_id_' }, { name: 'email_1', unique: true }, { name: 'createdAt_-1' } ]

// Drop by index name
await users.dropIndex('email_1');

// Drop by key pattern
await users.dropIndex({ email: 1 });

// Drop all indexes except _id
await users.dropIndexes();
```

---

## Change streams

Watch for real-time changes on a collection. Requires a replica set or MongoDB Atlas.

```js
// Watch all changes
const stream = users.watch();

// Watch specific operation types
const stream = users.watch([
    { $match: { operationType: { $in: ['insert', 'update'] } } },
]);

// Watch specific field value changes
const stream = users.watch([
    { $match: { 'fullDocument.role': 'admin' } },
]);

stream.on('change', (event) => {
    console.log('Operation:', event.operationType); // 'insert' | 'update' | 'delete'
    console.log('Document:', event.fullDocument);
    console.log('Changed fields:', event.updateDescription?.updatedFields);
});

stream.on('error', (err) => {
    console.error('Stream error:', err);
});

// Always close when done
await stream.close();
```

---

## Transactions

Requires a replica set or sharded cluster. MongoDB Atlas works out of the box.

```js
const result = await orders.withTransaction(async (session) => {
    // All operations share the same session — all commit or all roll back
    const order = await orders.insertOne(
        { userId, items, total },
        { session },
    );

    await inventory.updateOne(
        { productId },
        { $inc: { stock: -1 } },
        undefined,
        { session },
    );

    await wallet.updateOne(
        { userId },
        { $inc: { balance: -total } },
        undefined,
        { session },
    );

    return order;
});
// Commits on success, aborts automatically on any error
```

---

## Utilities

```js
// Convert a string to ObjectId
const oid = users.toObjectId('64a1f...');
// ObjectId('64a1f...')

// Validate a string as ObjectId
users.isValidObjectId('64a1f...');    // true
users.isValidObjectId('not-an-id');   // false
users.isValidObjectId(undefined);     // false
users.isValidObjectId(null);          // false

// Get the raw MongoDB Collection instance
// Use this for any operation not covered by DataLayer
const col = users.getCollection();
await col.aggregate([...]);
await col.findOneAndReplace(...);
```

---

## TrackedDataLayer *(optional)*

A drop-in replacement for `DataLayer` that automatically records every create, update and delete — tracking what fields changed, who made the change, and when.

**Existing `DataLayer` users are completely unaffected** — `TrackedDataLayer` is purely opt-in.

```js
// Before — regular DataLayer
import { DataLayer } from 'mongo-datalayer';
const users = new DataLayer('users', req.user);

// After — just swap the class name, API is identical
import { TrackedDataLayer } from 'mongo-datalayer';
const users = new TrackedDataLayer('users', req.user);
```

---

### Setup

```js
import { connect, TrackedDataLayer, configureTracker } from 'mongo-datalayer';

await connect(process.env.MONGODB_URI, { databaseName: 'myapp' });

// Optional — set global defaults once, all instances inherit them
configureTracker({
    track:        true,
    storage:      'collection',
    maxHistory:   50,
    ignoreFields: ['updatedAt', 'createdAt', 'updatedBy', 'createdBy'],
    operations:   ['create', 'update', 'delete'],
});

// Use exactly like DataLayer
const users = new TrackedDataLayer('users', req.user);
const posts = new TrackedDataLayer('posts', req.user);
```

---

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `track` | boolean | `true` | Enable or disable tracking entirely |
| `storage` | string | `'collection'` | Where to store history: `'collection'` or `'inline'` |
| `collection` | string | `'{col}_history'` | Custom history collection name (storage: collection only) |
| `historyField` | string | `'__history'` | Custom field name inside document (storage: inline only) |
| `maxHistory` | number | `0` (unlimited) | Max records per document — permanently deletes oldest when exceeded |
| `archiveAfter` | number | `false` (disabled) | Create a new archive doc every N changes — no data lost |
| `watchFields` | string[] | `[]` (all fields) | Only track changes to these fields |
| `ignoreFields` | string[] | `[]` | Never track changes to these fields |
| `operations` | string[] | `['create','update','delete']` | Which write operations to track |
| `meta` | object | `{}` | Custom fields merged into every history record for this instance |

> `archiveAfter` and `maxHistory` cannot both be active. If both are set, `archiveAfter` takes priority. `archiveAfter` only applies to `storage: 'collection'`.

---

### Storage modes

#### Separate collection (default)

Every history entry is stored as its own document in `{collection}_history` (or your custom name).

```js
const users = new TrackedDataLayer('users', req.user, {
    storage:    'collection',
    collection: 'audit_logs',   // defaults to 'users_history'
    maxHistory: 50,
});
```

**History record shape — create:**

```js
{
    _id:        ObjectId('...'),
    documentId: ObjectId('...'),   // the _id of the user that was created
    collection: 'users',
    operation:  'create',
    changedBy:  ObjectId('...'),   // from req.user.id
    changedAt:  1712000000,        // unix timestamp
    changes:    [],                // always empty on create
    snapshot:   {                  // full document at time of create
        name:  'Alice',
        email: 'alice@example.com',
        role:  'user',
    },
}
```

**History record shape — update:**

```js
{
    _id:        ObjectId('...'),
    documentId: ObjectId('...'),
    collection: 'users',
    operation:  'update',
    changedBy:  ObjectId('...'),
    changedAt:  1712000001,
    changes: [
        { field: 'role', from: 'user',  to: 'admin'      },
        { field: 'name', from: 'Alice', to: 'Alice Smith' },
    ],
    snapshot: {                    // full document AFTER the update
        name:  'Alice Smith',
        email: 'alice@example.com',
        role:  'admin',
    },
}
```

**History record shape — delete:**

```js
{
    _id:        ObjectId('...'),
    documentId: ObjectId('...'),
    collection: 'users',
    operation:  'delete',
    changedBy:  ObjectId('...'),
    changedAt:  1712000002,
    changes:    [],
    snapshot:   {                  // last known state BEFORE deletion
        name:  'Alice Smith',
        email: 'alice@example.com',
        role:  'admin',
    },
}
```

#### Inline — history inside the document

History stored as an embedded array inside the document itself.

```js
const users = new TrackedDataLayer('users', req.user, {
    storage:      'inline',
    historyField: '_changes',   // defaults to '__history'
    maxHistory:   10,           // keep last 10 entries
});
```

The user document will contain:

```js
{
    _id:   ObjectId('...'),
    name:  'Alice Smith',
    role:  'admin',
    email: 'alice@example.com',
    _changes: [
        {
            operation: 'update',
            changedBy: ObjectId('...'),
            changedAt: 1712000001,
            changes:   [
                { field: 'role', from: 'user', to: 'admin' },
                { field: 'name', from: 'Alice', to: 'Alice Smith' },
            ],
            snapshot:  { name: 'Alice Smith', role: 'admin', email: '...' },
        },
        {
            operation: 'create',
            changedBy: ObjectId('...'),
            changedAt: 1712000000,
            changes:   [],
            snapshot:  { name: 'Alice', role: 'user', email: '...' },
        },
    ]
}
```

---

### Track specific fields

```js
// ONLY track changes to role and email — all other fields ignored
const users = new TrackedDataLayer('users', req.user, {
    watchFields: ['role', 'email'],
});

await users.findByIdAndUpdate(id, {
    $set: { role: 'admin', name: 'Bob', updatedAt: 1712000001 }
});
// changes recorded:
// [ { field: 'role', from: 'user', to: 'admin' } ]
// ← name and updatedAt NOT in watchFields, so NOT tracked


// Track ALL fields EXCEPT these
const users = new TrackedDataLayer('users', req.user, {
    ignoreFields: ['updatedAt', 'updatedBy', 'lastSeen', 'loginCount'],
});

await users.findByIdAndUpdate(id, {
    $set: { role: 'admin', updatedAt: 1712000001, loginCount: 5 }
});
// changes recorded:
// [ { field: 'role', from: 'user', to: 'admin' } ]
// ← updatedAt and loginCount are in ignoreFields, so NOT tracked
```

---

### Track specific operations

```js
// Only track updates and deletes — create events NOT tracked
const users = new TrackedDataLayer('users', req.user, {
    operations: ['update', 'delete'],
});

// Only track deletes — useful for audit of removed records only
const logs = new TrackedDataLayer('logs', req.user, {
    operations: ['delete'],
});

// Disable all tracking on this instance
const temp = new TrackedDataLayer('temp', req.user, {
    track: false,   // behaves exactly like DataLayer — no history stored
});
```

---

### Custom fields (meta)

Add your own fields to every history record — at 3 levels, each merging on top of the previous.

**Merge priority — right side always wins:**

```
global meta  ←  instance meta  ←  per-operation meta
```

#### Level 1 — Global meta (set once, applies to all instances)

```js
configureTracker({
    meta: {
        environment: 'production',
        appVersion:  '2.0.0',
    },
});
```

#### Level 2 — Instance meta (applies to every operation on this instance)

```js
const users = new TrackedDataLayer('users', req.user, {
    meta: {
        ipAddress:  req.ip,
        userAgent:  req.headers['user-agent'],
        source:     'admin-panel',
        appVersion: '2.1.0',   // overrides global appVersion for this instance
    },
});

// Every write on `users` automatically includes ipAddress, userAgent, source ✅
await users.create({ name: 'Alice' });
await users.findByIdAndUpdate(id, { $set: { role: 'admin' } });
await users.findByIdAndDelete(id);
```

#### Level 3 — Per-operation meta (applies to just this one call)

```js
// create / insertOne
await users.create(
    { name: 'Alice', role: 'user' },
    { meta: { source: 'signup-form', campaign: 'launch-2024' } },
);

// insertMany
await users.insertMany(
    docs,
    {},
    { meta: { source: 'bulk-import', importId: 'IMP-001', importedBy: 'admin' } },
);

// findByIdAndUpdate
await users.findByIdAndUpdate(
    id,
    { $set: { role: 'admin' } },
    undefined,
    {},
    { meta: { reason: 'promoted by HR', ticket: 'HR-123', approvedBy: 'manager-id' } },
);

// updateOne
await users.updateOne(
    { email },
    { $set: { verified: true } },
    undefined,
    {},
    { meta: { source: 'email-verification', token: 'tok_abc' } },
);

// upsert
await users.upsert(
    { email },
    { $set: { plan: 'pro' } },
    {},
    { meta: { reason: 'upgrade', invoiceId: 'INV-789', gateway: 'stripe' } },
);

// findByIdAndDelete
await users.findByIdAndDelete(
    id,
    { meta: { reason: 'account violation', ticket: 'SUP-456', reviewedBy: 'admin-id' } },
);

// deleteOne
await users.deleteOne(
    { email },
    { meta: { reason: 'user requested account deletion', requestId: 'REQ-101' } },
);
```

#### Full merge example

```js
configureTracker({
    meta: { appVersion: '2.0.0', environment: 'production' },
});

const users = new TrackedDataLayer('users', req.user, {
    meta: { ipAddress: req.ip, appVersion: '2.1.0' },  // overrides global appVersion
});

await users.findByIdAndUpdate(
    id,
    { $set: { role: 'admin' } },
    undefined,
    {},
    { meta: { reason: 'promoted', appVersion: '2.2.0' } },  // overrides instance appVersion
);

// Final history record:
// {
//     operation:   'update',
//     changedBy:   ObjectId('...'),
//     changedAt:   1712000001,
//     changes:     [{ field: 'role', from: 'user', to: 'admin' }],
//     snapshot:    { name: 'Alice', role: 'admin', ... },
//     environment: 'production',   ← from global
//     ipAddress:   '192.168.1.1',  ← from instance
//     reason:      'promoted',     ← from operation
//     appVersion:  '2.2.0',        ← operation wins over instance and global
// }
```

---

### maxHistory vs archiveAfter

Two strategies for controlling how much history is stored per document — pick one.

#### maxHistory — keep last N records, delete oldest

When history exceeds the limit, **oldest records are permanently deleted**.

```js
const users = new TrackedDataLayer('users', req.user, {
    storage:    'collection',
    maxHistory: 100,
});
// After 101 writes: 100 records kept, 1 oldest permanently deleted
// After 200 writes: 100 records kept, 100 oldest permanently deleted
```

Use when you only need recent history and don't mind losing old records.

#### archiveAfter — create a new archive doc when full (default: false)

When history reaches the limit, a **new archive document is created**. Nothing is ever deleted — all history is preserved, split across multiple documents.

```js
const users = new TrackedDataLayer('users', req.user, {
    storage:      'collection',
    archiveAfter: 100,
});
```

After 245 changes, `users_history` has **3 documents** for that user:

```js
// Page 1 — full, sealed, read-only
{
    _id:        ObjectId('...'),
    documentId: ObjectId('abc'),
    collection: 'users',
    page:       1,
    archived:   true,    // sealed — will never be written to again
    count:      100,
    records:    [ /* 100 history entries */ ]
}

// Page 2 — full, sealed, read-only
{
    _id:        ObjectId('...'),
    documentId: ObjectId('abc'),
    collection: 'users',
    page:       2,
    archived:   true,
    count:      100,
    records:    [ /* 100 history entries */ ]
}

// Page 3 — current active page, still accumulating
{
    _id:        ObjectId('...'),
    documentId: ObjectId('abc'),
    collection: 'users',
    page:       3,
    archived:   false,   // still being written to
    count:      45,
    records:    [ /* 45 history entries so far */ ]
}
```

Use when you need a **complete, permanent audit trail** — every change is kept forever.

---

### Query history

```js
import {
    getHistory,
    getLastChange,
    restoreDocument,
    compareDiff,
} from 'mongo-datalayer';
```

#### getHistory

**Standard mode** (`archiveAfter: false`) — flat records, newest first.

```js
// Paginated (default)
const result = await getHistory('users', userId);
// {
//     data: [
//         { operation: 'update', changedAt: 1712000001, changes: [...], snapshot: {...} },
//         { operation: 'create', changedAt: 1712000000, changes: [],    snapshot: {...} },
//     ],
//     totalDocs:   2,
//     skip:        0,
//     limit:       50,
//     currentPage: 1,
//     totalPages:  1,
//     hasNextPage: false,
// }

// Plain array (no pagination wrapper)
const records = await getHistory('users', userId, { pagination: false });
// [ { operation: 'update', ... }, { operation: 'create', ... } ]

// Paginated with custom limit/skip
const result = await getHistory('users', userId, { limit: 10, skip: 0 });

// Custom history collection name
const result = await getHistory('users', userId, { historyCollection: 'audit_logs' });
```

**Archive mode** (`archiveAfter: N`) — one archive page at a time.

```js
// Latest page (default — most recent changes)
const latest = await getHistory('users', userId);
// {
//     records:    [ /* 45 entries */ ],
//     page:       3,
//     totalPages: 3,
//     count:      45,
//     archived:   false,
// }

// Oldest page — very first changes ever
const first = await getHistory('users', userId, { page: 1 });
// {
//     records:    [ /* 100 entries */ ],
//     page:       1,
//     totalPages: 3,
//     count:      100,
//     archived:   true,
// }

// Middle page
const second = await getHistory('users', userId, { page: 2 });
// {
//     records:    [ /* 100 entries */ ],
//     page:       2,
//     totalPages: 3,
//     count:      100,
//     archived:   true,
// }

// Custom history collection
const latest = await getHistory('users', userId, { historyCollection: 'audit_logs' });
```

#### getLastChange

Returns only the single most recent change record.

```js
const last = await getLastChange('users', userId);
// {
//     _id:       ObjectId('...'),
//     operation: 'update',
//     changedBy: ObjectId('...'),
//     changedAt: 1712000001,
//     changes:   [
//         { field: 'role', from: 'user', to: 'admin' },
//     ],
//     snapshot:  { name: 'Alice Smith', role: 'admin', email: '...' },
// }

// Returns null if no history found
const last = await getLastChange('users', '000000000000000000000000');
// null

// Custom collection
const last = await getLastChange('users', userId, { historyCollection: 'audit_logs' });
```

#### restoreDocument

Roll back a document to the exact state captured in a history snapshot.

```js
// Get full history
const records = await getHistory('users', userId, { pagination: false });

// Restore to the very first version (oldest = last in the array, newest first)
const original = records[records.length - 1];
const restored = await restoreDocument('users', userId, original._id);
// { _id: ..., name: 'Alice', role: 'user', ... }  ← original state restored

// Restore to a specific point in time
const restored = await restoreDocument('users', userId, records[2]._id);

// Custom collection
const restored = await restoreDocument('users', userId, historyId, {
    historyCollection: 'audit_logs',
});
```

#### compareDiff

Compare two history records to see exactly what changed between two points in time.

```js
const records = await getHistory('users', userId, { pagination: false });

// Compare oldest vs newest
const diff = await compareDiff(
    'users',
    records[records.length - 1]._id,  // older record
    records[0]._id,                    // newer record
);
// [
//     { field: 'role', version1: 'user',  version2: 'admin'      },
//     { field: 'name', version1: 'Alice', version2: 'Alice Smith' },
// ]

// Compare any two arbitrary points
const diff = await compareDiff('users', historyId1, historyId2);

// Custom collection
const diff = await compareDiff('users', historyId1, historyId2, {
    historyCollection: 'audit_logs',
});
```

---

## Graceful shutdown

```js
import { disconnect } from 'mongo-datalayer';

process.on('SIGTERM', async () => {
    await disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await disconnect();
    process.exit(0);
});
```

---

## Why not Mongoose?

| | Mongoose | mongo-datalayer |
|---|---|---|
| Schema validation | ✅ | ❌ use Zod / Joi separately |
| Boilerplate | Heavy | Minimal |
| Bundle size | Large | Tiny |
| Raw MongoDB access | Via `.collection()` | Native |
| Audit stamps | Manual | ✅ Automatic |
| Pagination built-in | ❌ | ✅ |
| Populate | ✅ | ✅ |
| Document history tracking | ❌ | ✅ via TrackedDataLayer |
| Field-level diff on update | ❌ | ✅ |
| Archive history (no data loss) | ❌ | ✅ via `archiveAfter` |
| Custom meta per operation | ❌ | ✅ |
| Own the code | ❌ | ✅ via `npx init --tracker` |

---

## License

ISC
