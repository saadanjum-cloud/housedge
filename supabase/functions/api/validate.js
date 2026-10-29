// Input checks for every write (same rules as the old server's security.js). The database has its own checks too.
export class InputError extends Error { constructor(msg) { super(msg); this.status = 400; this.expose = true; } }
const bad = msg => { throw new InputError(msg); };

export const v = {
  str(val, { max = 200, required = false, label = 'Text' } = {}) {
    if (val === undefined || val === null) return required ? bad(`${label} is required.`) : undefined;
    if (typeof val !== 'string' && typeof val !== 'number') bad(`${label} must be text.`);
    const s = String(val).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (required && !s) bad(`${label} is required.`);
    if (s.length > max) bad(`${label} is too long (max ${max} characters).`);
    return s;
  },
  oneOf(val, allowed, label = 'Value') {
    if (val === undefined || val === null) return undefined;
    if (!allowed.includes(val)) bad(`${label} is not a valid choice.`);
    return val;
  },
  list(val, { max = 50, item = x => x, label = 'List' } = {}) {
    if (val === undefined || val === null) return undefined;
    if (!Array.isArray(val)) bad(`${label} must be a list.`);
    if (val.length > max) bad(`${label} has too many items (max ${max}).`);
    return val.map(item);
  },
  num(val, { min = 0, max = 1e9, label = 'Number', integer = false } = {}) {
    if (val === undefined || val === null || val === '') return undefined;
    const n = Number(val);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) bad(`${label} must be a number.`);
    if (n < min || n > max) bad(`${label} must be between ${min} and ${max}.`);
    return n;
  },
  id(val) { const n = Number(val); return Number.isInteger(n) && n > 0 ? n : bad('Invalid id.'); },
  obj(val, { maxBytes = 20000, label = 'Data' } = {}) {
    if (val === undefined || val === null) return undefined;
    if (typeof val !== 'object' || Array.isArray(val)) bad(`${label} must be an object.`);
    if (JSON.stringify(val).length > maxBytes) bad(`${label} is too large.`);
    return val;
  },
};

// Only plain web links may be stored or shown as links (blocks javascript:, data:, file: and the like).
export function safeHttpUrl(u, max = 2000) {
  if (typeof u !== 'string' || u.length > max) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}
