# mongo-datalayer

A zero-boilerplate MongoDB data layer.  
One singleton client, full CRUD, automatic audit stamps — set up in seconds.

---

## Two ways to use (Recommended option-2)

### Option 1 — Import directly from the package

Install once, import anywhere. Files stay inside `node_modules`.

```bash
npm install mongo-datalayer mongodb
```

```js
import { connect, disconnect, DataLayer } from 'mongo-datalayer';
```

### Option 2 — Copy files into your project

Copies `mongodb.js`, `datalayer.js`, and `datetime.js` directly into your project so you own and can edit the code.

```bash
npx mongo-datalayer init
```

This creates:

```
your-project/
├── config/
│   └── mongodb.js       ← singleton client
├── service/
│   └── datalayer.js     ← DataLayer class
├── helpers/
│   └── datetime.js      ← getTimestamp, selectToProject
```

Then import from your own files:

```js
import { connect, disconnect } from './config/mongodb.js';
import DataLayer              from './service/datalayer.js';
```

> Run with `--force` to overwrite existing files:
> ```bash
> npx mongo-datalayer init --force
> ```

---

## Quick start

```js
import { connect, disconnect, DataLayer } from 'mongo-datalayer';

// Connect once at app startup
await connect(process.env.MONGODB_URI, {
    databaseName: 'myapp',
});

const users = new DataLayer('users');

const user = await users.create({ name: 'Alice', email: 'alice@example.com' });
console.log(user);
// { _id: ObjectId('...'), name: 'Alice', createdAt: 1712000000, updatedAt: 1712000000 }

await disconnect();
```

---

## Connect options

```js
await connect('mongodb://localhost:27017', {
    databaseName: 'myapp',   // required
    maxPoolSize:  10,         // default 10
    minPoolSize:  2,          // default 2
});
```

---

## DataLayer

Create a `DataLayer` instance per collection. Pass the logged-in user as the second argument to get automatic `createdBy` / `updatedBy` / `createdAt` / `updatedAt` audit stamps.

```js
const users = new DataLayer('users');            // no audit stamps
const posts = new DataLayer('posts', req.user);  // adds createdBy / updatedBy
```

---

## Create

### Insert one

Returns the full inserted document including `_id`.

```js
const user = await users.insertOne({ name: 'Alice', email: 'alice@example.com', role: 'user' });
// { _id: ObjectId('...'), name: 'Alice', createdAt: 1712000000, updatedAt: 1712000000 }
```

### create() — alias for insertOne

```js
const user = await users.create({ name: 'Alice', email: 'alice@example.com' });
```

### Insert many

Returns an array of all inserted documents with their `_id` values.

```js
const inserted = await users.insertMany([
    { name: 'Bob',     email: 'bob@example.com',     role: 'user' },
    { name: 'Charlie', email: 'charlie@example.com', role: 'admin' },
]);
// [ { _id: ..., name: 'Bob', ... }, { _id: ..., name: 'Charlie', ... } ]
```

---

## Read

### Find by ID

```js
// All fields
const user = await users.findById('64a1f...');

// Exclude fields — string syntax
const user = await users.findById('64a1f...', '-password');

// Include fields — string syntax
const user = await users.findById('64a1f...', 'name email role');

// Object projection
const user = await users.findById('64a1f...', { name: 1, email: 1 });
```

### Find one

```js
// Basic filter
const user = await users.findOne({ email: 'alice@example.com' });

// With projection (object)
const user = await users.findOne(
    { email: 'alice@example.com' },
    { projection: { name: 1, email: 1 } },
);

// With projection (string)
const user = await users.findOne(
    { email: 'alice@example.com' },
    { projection: '-password -age' },
);

// With sort and skip
const user = await users.findOne(
    { role: 'admin' },
    { sort: { createdAt: -1 }, skip: 0 },
);
```

### Find many — paginated

Returns `{ data, totalDocs, currentPage, totalPages, hasNextPage, skip, limit }`.

```js
// Basic paginated
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0 },
);

// With sort
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 0, sort: { createdAt: -1 } },
);

// With projection — object syntax (include fields)
const result = await users.find(
    { role: 'user' },
    {
        limit:      20,
        skip:       0,
        projection: { name: 1, email: 1 },
    },
);

// With projection — string syntax (include)
const result = await users.find(
    { role: 'user' },
    {
        limit:      20,
        skip:       0,
        projection: 'name email role',
    },
);

// With projection — string syntax (exclude)
const result = await users.find(
    { role: 'user' },
    {
        limit:      20,
        skip:       0,
        projection: '-password -age',
    },
);

// With projection — string syntax (mixed)
const result = await users.find(
    { role: 'user' },
    {
        limit:      20,
        skip:       0,
        projection: 'name email -password',
    },
);

// Page 2
const result = await users.find(
    { role: 'user' },
    { limit: 20, skip: 20 },
);

// Reading paginated result
console.log(result.data);         // array of documents
console.log(result.totalDocs);    // total matching documents
console.log(result.currentPage);  // current page number
console.log(result.totalPages);   // total number of pages
console.log(result.hasNextPage);  // true / false
```

### Find many — plain array (no pagination)

```js
// All documents
const all = await users.find({}, { pagination: false });

// With filter
const admins = await users.find({ role: 'admin' }, { pagination: false });

// With projection
const all = await users.find(
    {},
    {
        pagination: false,
        projection: 'name email role',
    },
);

// With sort
const all = await users.find(
    {},
    {
        pagination: false,
        sort:       { name: 1 },
        projection: '-password',
    },
);
```

**Projection string syntax**

| Syntax | Meaning |
|---|---|
| `"name email"` | include only these fields |
| `"+name +email"` | include (explicit `+`) |
| `"-password"` | exclude this field |
| `"-password -age"` | exclude multiple fields |
| `"name -password"` | include name, exclude password |

### Exists — lightweight check

Does not fetch the full document — only checks for `_id`.

```js
const taken = await users.exists({ email: 'alice@example.com' }); // true or false
```

### Distinct values

```js
const roles = await users.distinct('role');
// [ 'admin', 'user' ]

// With filter
const roles = await users.distinct('role', { active: true });
```

### Count

```js
// Exact count with filter (uses collection scan)
const count = await users.countDocuments({ role: 'user' });

// Fast estimated total — no filter, uses collection metadata
const approx = await users.estimatedCount();
```

### Raw cursor — stream large datasets

Use this when the result set is too large to load into memory at once.

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
```

---

## Update

### Update by ID

Returns the updated document.

```js
const updated = await users.findByIdAndUpdate('64a1f...', {
    $set: { role: 'admin' },
});
```

### Update one — arbitrary filter

Returns the updated document.

```js
const updated = await users.updateOne(
    { email: 'alice@example.com' },
    { $set: { verified: true } },
);

// Increment a field
const updated = await users.updateOne(
    { _id: id },
    { $inc: { loginCount: 1 } },
);

// Push to an array
const updated = await users.updateOne(
    { _id: id },
    { $push: { tags: 'vip' } },
);
```

### Update with arrayFilters — nested array elements

```js
await posts.findByIdAndUpdate(
    postId,
    { $set: { 'comments.$[c].approved': true } },
    [{ 'c._id': new ObjectId(commentId) }],
);
```

### Update many

```js
await users.updateMany(
    { plan: 'free' },
    { $set: { trialExpired: true } },
);
```

### Upsert — update if exists, insert if not

```js
const doc = await settings.upsert(
    { userId: 'abc123' },                  // filter
    { $set: { theme: 'dark', lang: 'en' } }, // update
);
```

### Replace one

Replaces the entire document (no update operators).

```js
// findOneAndReplace — returns the new document
const replaced = await users.findOneAndReplace(
    { _id: id },
    { name: 'Alice V2', email: 'v2@example.com' },
);

// replaceOne — no return value, just the result
await users.replaceOne(
    { _id: id },
    { name: 'Alice V2', email: 'v2@example.com' },
);
```

---

## Delete

### Delete by ID

Returns the deleted document.

```js
const deleted = await users.findByIdAndDelete('64a1f...');
console.log(deleted.name); // 'Alice'
```

### Delete one — arbitrary filter

Returns the deleted document.

```js
const deleted = await users.deleteOne({ email: 'spam@example.com' });
```

### Delete many

```js
await users.deleteMany({ archived: true });

// Delete all
await users.deleteMany({});
```

### Bulk delete — efficient for large sets

```js
await logs.bulkDelete({ createdAt: { $lt: cutoff } });
```

---

## Aggregation

### Full pipeline

```js
const stats = await orders.aggregate([
    { $match: { status: 'paid' } },
    { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    { $sort:  { total: -1 } },
    { $limit: 10 },
]);
```

### groupBy — convenience shorthand

```js
// Count per group
const byRole = await users.groupBy('role');
// [ { _id: 'admin', count: 3 }, { _id: 'user', count: 97 } ]

// With accumulators
const revenue = await orders.groupBy(
    'productId',
    { total: { $sum: '$amount' }, avg: { $avg: '$amount' } },
);

// With pre-filter
const revenue = await orders.groupBy(
    'productId',
    { total: { $sum: '$amount' } },
    { status: 'paid' },              // only paid orders
);
```

---

## Bulk operations

### bulkWrite — mixed operations

```js
await users.bulkWrite([
    { insertOne:  { document: { name: 'Dave', role: 'user' } } },
    { updateOne:  { filter: { _id: id }, update: { $set: { active: false } } } },
    { deleteOne:  { filter: { _id: oldId } } },
    { updateMany: { filter: { role: 'guest' }, update: { $set: { expired: true } } } },
]);
```

### bulkUpsert — upsert many by a key field

```js
// Upsert by 'sku'
await products.bulkUpsert(productsArray, 'sku');

// Upsert by 'email'
await users.bulkUpsert(usersArray, 'email');

// Default match field is '_id'
await users.bulkUpsert(usersArray);
```

---

## Indexes

```js
// Single index
await users.createIndex({ email: 1 }, { unique: true });

// TTL index — auto-delete after expiry
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index
await orders.createIndex({ userId: 1, createdAt: -1 });

// Multiple indexes at once
await users.createIndexes([
    { key: { email: 1 },     unique: true },
    { key: { createdAt: -1 } },
    { key: { role: 1, active: 1 } },
]);

// List all indexes
const indexes = await users.listIndexes();
console.log(indexes.map(i => i.name));

// Drop by name
await users.dropIndex('email_1');

// Drop by key pattern
await users.dropIndex({ email: 1 });

// Drop all indexes (except _id)
await users.dropIndexes();
```

---

## Change streams

Watch for real-time changes on a collection. Requires a replica set or Atlas.

```js
// Watch all changes
const stream = users.watch();

// Watch specific operations
const stream = users.watch([
    { $match: { operationType: { $in: ['insert', 'update'] } } },
]);

// Watch for a specific field value
const stream = users.watch([
    { $match: { 'fullDocument.role': 'admin' } },
]);

stream.on('change', (event) => {
    console.log('Operation:', event.operationType);
    console.log('Document:', event.fullDocument);
});

stream.on('error', (err) => {
    console.error('Stream error:', err);
});

// Always close when done
await stream.close();
```

---

## Transactions

Requires a replica set or sharded cluster (Atlas works out of the box).

```js
const result = await orders.withTransaction(async (session) => {
    // All operations inside share the same session
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
// Commits automatically on success, aborts on any error
```

---

## Utilities

```js
// Convert string to ObjectId
const oid = users.toObjectId('64a1f...');

// Check if a string is a valid ObjectId
users.isValidObjectId('64a1f...');  // true
users.isValidObjectId('invalid');   // false
users.isValidObjectId(undefined);   // false

// Get the raw MongoDB Collection instance
// Use this for anything DataLayer doesn't cover
const col = users.getCollection();
await col.findOneAndReplace(...);
await col.watch(...);
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
| Audit stamps | Manual | Automatic |
| Pagination built-in | ❌ | ✅ |
| Own the code | ❌ | ✅ via `npx init` |

---

## License

ISC

---

## Populate

Resolve ObjectId references to full documents from other collections — like Mongoose's `.populate()`. Uses `$lookup` under the hood, supports pagination and projection.

### Single reference

```js
// posts collection: { title, authorId (ObjectId → users) }

const result = await posts.populate(
    { published: true },
    [{ field: 'authorId', collection: 'users' }],
    { limit: 10, skip: 0 },
);

// result.data[0].authorId is now the full user document:
// { _id: ..., name: 'Alice', email: 'alice@example.com', ... }
```

### Multiple references at once

```js
// orders collection: { total, userId (→ users), productId (→ products) }

const result = await orders.populate(
    { status: 'paid' },
    [
        { field: 'userId',    collection: 'users'    },
        { field: 'productId', collection: 'products' },
    ],
    { limit: 20, skip: 0 },
);

// result.data[0].userId    → full user document
// result.data[0].productId → full product document
```

### Array of ObjectIds

Set `array: true` when the field holds an array of ObjectIds.

```js
// posts collection: { title, tagIds: [ObjectId, ObjectId, ...] }

const result = await posts.populate(
    { published: true },
    [{ field: 'tagIds', collection: 'tags', array: true }],
);

// result.data[0].tagIds → [ { _id: ..., name: 'mongodb' }, { _id: ..., name: 'nodejs' } ]
```

### With projection on the joined collection

Only bring in specific fields from the foreign collection.

```js
const result = await posts.populate(
    { published: true },
    [{
        field:      'authorId',
        collection: 'users',
        projection: { name: 1, email: 1 },   // only name and email from users
    }],
);

// result.data[0].authorId → { _id: ..., name: 'Alice', email: 'alice@example.com' }
// password, createdAt etc. are NOT included
```

### With projection on the result

Apply a projection to the final output after populating.

```js
const result = await posts.populate(
    { published: true },
    [{ field: 'authorId', collection: 'users', projection: { name: 1 } }],
    {
        limit:      10,
        skip:       0,
        projection: '-__v -updatedAt',    // exclude from final result
    },
);
```

### Paginated (default)

Returns the same shape as `find()`.

```js
const result = await posts.populate(
    { published: true },
    [{ field: 'authorId', collection: 'users' }],
    { limit: 10, skip: 0, sort: { createdAt: -1 } },
);

console.log(result.data);        // array of populated documents
console.log(result.totalDocs);   // total matching
console.log(result.currentPage); // current page
console.log(result.totalPages);  // total pages
console.log(result.hasNextPage); // boolean
```

### Plain array (no pagination)

```js
const posts = await posts.populate(
    { published: true },
    [{ field: 'authorId', collection: 'users' }],
    { pagination: false },
);
// returns a plain array
```

### All options

```js
const result = await posts.populate(
    filter,           // MongoDB filter
    [
        {
            field:      'authorId',   // field on this collection
            collection: 'users',      // foreign collection
            projection: { name: 1 }, // fields to include from foreign doc (optional)
            array:      false,        // true if field holds an array of ObjectIds
        },
    ],
    {
        limit:      20,              // default 50
        skip:       0,               // default 0
        sort:       { createdAt: -1 }, // default { _id: 1 }
        pagination: true,            // false for plain array
        projection: '-password',     // projection on the final output
    },
);
```