import crypto from 'crypto';

/**
 * Creates a deterministic hash of an object by sorting keys.
 */
export const generateHash = (content: unknown): string => {
    const stableStringify = (obj: unknown): string => {
        if (typeof obj !== 'object' || obj === null) {
            return JSON.stringify(obj);
        }
        if (Array.isArray(obj)) {
            return '[' + obj.map(stableStringify).join(',') + ']';
        }
        const keys = Object.keys(obj as object).sort();
        const parts = keys.map(key => {
            return `"${key}":${stableStringify((obj as any)[key])}`;
        });
        return '{' + parts.join(',') + '}';
    };

    return crypto.createHash('sha1').update(stableStringify(content)).digest('hex');
};
