export const sep = '/';
export function basename(p: string): string {
	const i = p.lastIndexOf('/');
	return i === -1 ? p : p.slice(i + 1);
}
export function dirname(p: string): string {
	const i = p.lastIndexOf('/');
	if (i === -1) { return '.'; }
	if (i === 0) { return '/'; }
	return p.slice(0, i);
}
function normalizePosix(p: string): string {
	if (!p) { return '.'; }
	const abs = p.startsWith('/');
	const out: string[] = [];
	for (const part of p.split('/')) {
		if (!part || part === '.') { continue; }
		if (part === '..') {
			if (out.length && out[out.length - 1] !== '..') { out.pop(); }
			else if (!abs) { out.push('..'); }
			continue;
		}
		out.push(part);
	}
	let r = out.join('/');
	if (abs) { r = '/' + r; }
	if (!r) { r = abs ? '/' : '.'; }
	if (p.endsWith('/') && !r.endsWith('/')) { r += '/'; }
	return r;
}
export const posix = { normalize: normalizePosix, sep: '/' };
export const win32 = { normalize: (p: string) => normalizePosix(p).replace(/\//g, '\\'), sep: '\\' };
export const isWindows = false;
export const Schemas = { file: 'file', vscodeRemote: 'vscode-remote' };
export class URI {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	private constructor(scheme: string, authority: string, path: string) {
		this.scheme = scheme; this.authority = authority; this.path = path;
	}
	static file(p: string): URI { return new URI('file', '', p.startsWith('/') ? p : '/' + p); }
	static from(c: { scheme: string; authority?: string; path?: string }): URI {
		return new URI(c.scheme, c.authority ?? '', c.path ?? '');
	}
	get fsPath(): string { return this.path; }
	toString(): string { return `${this.scheme}://${this.authority}${this.path}`; }
}
