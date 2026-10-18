// Explicit checks for a restored backup's state. A backup file is untrusted input, so every
// collection is checked field by field, including collections that start empty, before it can
// replace local data. The first problem is reported with its location, for example
// "issues[0].reporter.id must be an integer".

export class BackupError extends Error {}
const reject = (path, message) => { throw new BackupError(`This backup cannot be restored: ${path} ${message}.`); };

const TYPES = {
  string: value => typeof value === 'string',
  boolean: value => typeof value === 'boolean',
  number: value => Number.isFinite(value),
  integer: value => Number.isSafeInteger(value),
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  any: value => value !== undefined
};
const NAMES = { string: 'text', boolean: 'true or false', number: 'a finite number', integer: 'an integer', object: 'an object', any: 'present' };

// Schemas: a type name ('string', 'number', 'integer', 'boolean', 'object', 'any'), with a trailing
// '?' to also allow null; [schema] for a list of that schema; { field: schema } for an object with
// those fields (a trailing '?' on a field name makes the field optional; other fields are kept);
// or a function (value, path) that rejects by returning a message or by calling check itself.
export function check(value, schema, path) {
  if (typeof schema === 'string') {
    const nullable = schema.endsWith('?'), type = nullable ? schema.slice(0, -1) : schema;
    if (nullable && value === null) return;
    if (!TYPES[type](value)) reject(path, value === undefined ? 'is missing' : `must be ${NAMES[type]}${nullable ? ' or null' : ''}`);
  } else if (typeof schema === 'function') {
    const message = schema(value, path);
    if (message) reject(path, message);
  } else if (Array.isArray(schema)) {
    if (!Array.isArray(value)) reject(path, value === undefined ? 'is missing' : 'must be a list');
    value.forEach((item, index) => check(item, schema[0], `${path}[${index}]`));
  } else {
    if (!TYPES.object(value)) reject(path, value === undefined ? 'is missing' : 'must be an object');
    for (const [field, item] of Object.entries(schema)) {
      const optional = field.endsWith('?'), name = optional ? field.slice(0, -1) : field;
      if (optional && value[name] === undefined) continue;
      check(value[name], item, `${path}.${name}`);
    }
  }
}

export const orNull = schema => (value, path) => { if (value !== null) check(value, schema, path); };
export const oneOf = (...values) => value => values.includes(value) ? undefined : `must be one of ${values.map(item => JSON.stringify(item)).join(', ')}`;
export const between = (minimum, maximum, type = 'number') => value =>
  TYPES[type](value) && value >= minimum && value <= maximum ? undefined : `must be ${type === 'integer' ? 'an integer' : 'a number'} from ${minimum} to ${maximum}`;
export const longitude = between(-180, 180), latitude = between(-90, 90);
export const position = value => Array.isArray(value) && value.length === 2 && longitude(value[0]) === undefined && latitude(value[1]) === undefined ? undefined : 'must be a [longitude, latitude] pair';
export const atLeast = (count, schema) => (value, path) => {
  check(value, [schema], path);
  if (value.length < count) return `must contain at least ${count} items`;
};

// Every record in each list has a distinct id.
export function uniqueIds(records, path) {
  const seen = new Set();
  records.forEach((record, index) => {
    if (seen.has(record.id)) reject(`${path}[${index}].id`, `repeats id ${record.id}`);
    seen.add(record.id);
  });
}

// A value that names another record must name one that exists.
export function refersTo(value, ids, path, label) {
  if (!ids.has(value)) reject(path, `refers to ${label} ${JSON.stringify(value)}, which does not exist`);
}

// A next-id counter must be above every id in use, or new records would reuse an id.
export function counterAbove(counter, ids, path) {
  const highest = ids.reduce((max, id) => Math.max(max, id), 0);
  if (!Number.isSafeInteger(counter) || counter <= highest) reject(path, `must be an integer greater than ${highest}, the highest id in use`);
}
