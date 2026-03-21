/**
 * Current Unix timestamp in seconds.
 * @returns {number}
 */
export function getTimestamp() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Converts a Mongoose-style select string into a MongoDB projection object.
 *
 * Rules:
 *   "+field"  →  include  (1)
 *   "-field"  →  exclude  (0)
 *   "field"   →  include  (1)
 *
 * @param {string} selectString  e.g. "+name +email -password"
 * @returns {Record<string, 0|1>} e.g. { name: 1, email: 1, password: 0 }
 *
 * @example
 * selectToProject('+name -password')  // { name: 1, password: 0 }
 */
export function selectToProject(selectString) {
    const projection = {};
    selectString.trim().split(/\s+/).forEach((field) => {
        if (field.startsWith('+')) projection[field.slice(1)] = 1;
        else if (field.startsWith('-')) projection[field.slice(1)] = 0;
        else projection[field] = 1;
    });
    return projection;
}