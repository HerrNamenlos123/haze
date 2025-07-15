import deepEqual from 'deep-equal';

type Diff = {
    path: string;
    expected: any;
    actual: any;
};

export function compareWithDebug(expected: any, actual: any): { equal: boolean; diffs: Diff[] } {
    const seen = new WeakSet();
    const diffs: Diff[] = [];

    function walk(a: any, b: any, path: string) {
        if (deepEqual(a, b)) return;

        // Handle null/undefined early
        if (a === undefined && b !== undefined) {
            diffs.push({ path, expected: a, actual: b });
            return;
        }

        if (a !== undefined && b === undefined) {
            diffs.push({ path, expected: a, actual: b });
            return;
        }

        if (a == null || b == null) {
            diffs.push({ path, expected: a, actual: b });
            return;
        }

        // Avoid cycles
        if (a && typeof a === 'object') {
            if (seen.has(a)) return;
            seen.add(a);
        }

        // Type mismatch
        if (typeof a !== typeof b) {
            diffs.push({ path, expected: a, actual: b });
            return;
        }

        // Arrays
        if (Array.isArray(a) && Array.isArray(b)) {
            const len = Math.max(a.length, b.length);
            for (let i = 0; i < len; i++) {
                walk(a[i], b[i], `${path}[${i}]`);
            }
            return;
        }

        // Objects
        if (typeof a === 'object' && typeof b === 'object') {
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            for (const key of keys) {
                walk(a[key], b[key], path ? `${path}.${key}` : key);
            }
            return;
        }

        // Primitive mismatch
        diffs.push({ path, expected: a, actual: b });
    }

    walk(expected, actual, '');

    return {
        equal: diffs.length === 0,
        diffs
    };
}
