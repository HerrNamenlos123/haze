// Generates the Haze differential test corpus from VS Code's own scorer.
//
//   cd fuzzymatchtest/oracle && bun run generate.ts ../src/cases_generated.hz
//
// Deterministic: the same inputs always produce a byte-identical file, so a
// regeneration that changes anything means the oracle changed.
// Every expectation in cases_generated.hz comes out of oracle.ts, which is a
// mechanical extraction of vscode/src/vs/base/common/{filters,fuzzyScorer}.ts
// verified by running VS Code's published test suite against it (verify.test.ts).

import { readFileSync, writeFileSync } from 'fs';
import {
	prepareQuery, scoreFuzzy, scoreItemFuzzy, compareItemsByFuzzyScore,
	type IItemAccessor, type IItemScore, type IMatch,
} from './oracle.ts';
import { basename, dirname } from './shims.ts';

type Item = { label: string; description: string; path: string };

const accessor: IItemAccessor<Item> = {
	getItemLabel: (i) => i.label,
	getItemDescription: (i) => i.description,
	getItemPath: (i) => i.path,
};

function itemFromPath(path: string): Item {
	const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	if (cut < 0) { return { label: path, description: '', path }; }
	return { label: path.slice(cut + 1), description: path.slice(0, cut), path };
}

// --- Haze literal emission ---------------------------------------------------

function hz(s: string): string {
	let out = '"';
	for (const ch of s) {
		if (ch === '"') { out += '\\"'; }
		else if (ch === '\\') { out += '\\\\'; }
		else if (ch === '\n') { out += '\\n'; }
		else if (ch === '\t') { out += '\\t'; }
		else if (ch === '\r') { out += '\\r'; }
		else { out += ch; }
	}
	return out + '"';
}

const posStr = (p: number[]) => p.join(',');
const spanStr = (m: IMatch[] | undefined) => (m ?? []).map(x => `${x.start}-${x.end}`).join(',');

// --- Corpus ------------------------------------------------------------------

const repoPaths = readFileSync('repo-paths.txt', 'utf8').split('\n').filter(Boolean);

const handPaths = [
	'/xyz/some/path/someFile123.txt',
	'/xyz/others/spath/some/xsp/file123.txt',
	'/1a111d1/11a1d1/something.txt',
	'/src/vs/editor/browser/viewParts/lineNumbers/flipped-cursor-2x.svg',
	'/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts',
	'/src/vs/base/common/fuzzyScorer.ts',
	'/src/vs/base/common/filters.ts',
	'/app/constants/color.js',
	'/app/components/model/input/Color.js',
	'/window.ts',
	'/windowActions.ts',
	'/editor/code/win/window.ts',
	'/some/path/fileA.txt',
	'/some/path/other/fileB.txt',
	'/lib/model/util.ts',
	'/lib/models/util.ts',
	'/node_modules/.bin/tsc',
	'/HelLo-World',
	'/ede',
	'/etem',
	'/abcde',
	'/ASDFasdfasdf',
	'/asdfasdfasdf',
	'/projects/ui/cula/ats/target.mk',
	'/build/tools/gyp/pylib/gyp/generator/make.py',
	'/vs/workbench/api/node/extHostConfiguration.ts',
	'/src/main.hz',
	'/main/src/util.hz',
	'/README.md',
	'/docs/readme/index.md',
];

const targets = [...new Set([...handPaths, ...repoPaths])];

// The full cross product is ~75k cases per group, which would make the
// generated Haze file take longer to compile than the whole rest of the
// project. Sample it down deterministically instead: every case involving a
// hand-picked path is kept (those are the ones chosen to isolate a specific
// rule), and the bulk repo-path cases are thinned with a seeded shuffle so
// the sample stays diverse and stays identical between regenerations.
const handSet = new Set(handPaths);
function sample<T>(rows: T[], keepAll: (row: T) => boolean, budget: number): T[] {
	const forced: number[] = [];
	const rest: number[] = [];
	rows.forEach((row, i) => (keepAll(row) ? forced : rest).push(i));
	let seed = 0x9e3779b9;
	const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	const take = Math.max(0, budget - forced.length);
	const picked = forced.concat(rest.slice(0, take)).sort((a, b) => a - b);
	return picked.map(i => rows[i]);
}

const queries = [
	'', 'a', 'z', 'ts', 'hz', 'main', 'Main', 'MAIN', 'mn', 'src', 'srcmain',
	'src/main', 'src\\main', 'sm', 'util', 'utl', 'fuzzy', 'fz', 'fzs',
	'fuzzyScorer', 'FS', 'scorer.ts', 'index', 'idx', 'color', 'Color',
	'window', 'window.ts', 'wa', 'file', 'file1', 'f1', 'txt', '.txt',
	'someFile', 'sf', 'sfp', 'xyz/some', 'somepath', 'ede', 'de', 'etem', 'em',
	'hw', 'HW', 'ld', 'Ld', 'l', 'L', 'h', 'H', 'W', '4',
	'"main"', '"src/main"', '"zz"', 'src main', 'main hz', 'a b c',
	'ma*in', 'ma…in', 'main#', '#', 'ma in', '  main  ', 'main ',
	'lineNumbers', 'lnn', 'flipped', 'cursor2x', 'explorer', 'expl',
	'nodemodules', 'nm', 'bintsc', 'gypmake', 'make.py', 'py',
	'targetmk', 'culaats', 'asdf', 'ASDF', 'abcde', 'abc',
	'contrib/files', 'browser/views', 'vs/base', 'common/f',
];

// --- 1. raw scoreFuzzy -------------------------------------------------------

type ScoreCase = { target: string; query: string; scattered: boolean; score: number; positions: string };
const scoreCases: ScoreCase[] = [];
{
	const seen = new Set<string>();
	// Every (target, query) whose characters are all ASCII. Both contiguity
	// modes, because they take different branches in the matrix fill.
	for (const t of targets) {
		for (const q of queries) {
			for (const scattered of [true, false]) {
				const key = `${t}\u0000${q}\u0000${scattered}`;
				if (seen.has(key)) { continue; }
				seen.add(key);
				const pq = prepareQuery(q);
				const [score, positions] = scoreFuzzy(t, pq.normalized, pq.normalizedLowercase, scattered);
				scoreCases.push({ target: t, query: q, scattered, score, positions: posStr(positions) });
			}
		}
	}
}

const sampledScoreCases = sample(scoreCases, c => handSet.has(c.target), 2400);

// --- 2. prepareQuery ---------------------------------------------------------

const queryInputs = [...new Set([...queries,
	'a\tb', 'a\nb', 'a\u00a0b', 'a\u2028b', 'a\u3000b', 'a\ufeffb',
	'\u2026main', 'ma\u2026in', '**', '""', '"', 'a#', '#a', 'a##',
	'C:\\Users\\x\\file.ts', '..\\rel\\path', 'a/b/c', ' ', '   ',
	'"quoted phrase"', '"a" "b"', 'MiXeD Case', 'trailing ', ' leading',
])];

// --- 3. scoreItem ------------------------------------------------------------

type ItemCase = {
	label: string; description: string; path: string; query: string;
	scattered: boolean; score: number; labelSpans: string; descriptionSpans: string;
};
const itemCases: ItemCase[] = [];
{
	for (const t of targets) {
		const item = itemFromPath(t);
		for (const q of queries) {
			for (const scattered of [true, false]) {
				const res: IItemScore = scoreItemFuzzy(item, prepareQuery(q), scattered, accessor, Object.create(null));
				itemCases.push({
					...item, query: q, scattered,
					score: res.score,
					labelSpans: spanStr(res.labelMatch),
					descriptionSpans: spanStr(res.descriptionMatch),
				});
			}
		}
	}
	// Path-identity: the query IS the path.
	for (const t of targets.slice(0, 40)) {
		const item = itemFromPath(t);
		for (const scattered of [true, false]) {
			const res = scoreItemFuzzy(item, prepareQuery(t), scattered, accessor, Object.create(null));
			itemCases.push({
				...item, query: t, scattered, score: res.score,
				labelSpans: spanStr(res.labelMatch), descriptionSpans: spanStr(res.descriptionMatch),
			});
		}
	}
}

const sampledItemCases = sample(itemCases, c => handSet.has(c.path), 2400);

// --- 4. end-to-end ranking ---------------------------------------------------

type RankCase = { query: string; scattered: boolean; pool: number; expected: string };
const rankCases: RankCase[] = [];
const rankPools: string[][] = [];
{
	// Small hand-picked pools that isolate one ordering rule each, plus larger
	// slices of the real repo tree so the tie-breaks get exercised in bulk.
	const pools: string[][] = rankPools;
	pools.push(
		handPaths,
		targets.slice(0, 50),
		targets.slice(50, 100),
		targets.slice(100, 150),
		targets.slice(150, 200),
		targets.slice(200, 250),
		['/window.ts', '/windowActions.ts', '/editor/code/win/window.ts'],
		['/app/constants/color.js', '/app/components/model/input/Color.js'],
		['/lib/model/util.ts', '/lib/models/util.ts'],
		['/some/path/fileA.txt', '/some/path/other/fileB.txt'],
		['/ede', '/etem', '/abcde'],
		['/ASDFasdfasdf', '/asdfasdfasdf'],
	);
	for (let poolIndex = 0; poolIndex < pools.length; poolIndex++) {
		const pool = pools[poolIndex];
		const items = pool.map(itemFromPath);
		for (const q of queries) {
			for (const scattered of [true, false]) {
				const pq = prepareQuery(q);
				if (!pq.normalized) { continue; }
				const cache = Object.create(null);
				const scored = items
					.map((item, index) => ({ item, index, score: scoreItemFuzzy(item, pq, scattered, accessor, cache).score }))
					.filter(e => e.score !== 0);
				// Stable sort, exactly as VS Code's quick open does it.
				scored.sort((a, b) => compareItemsByFuzzyScore(a.item, b.item, pq, scattered, accessor, cache));
				if (scored.length === 0) { continue; }
				rankCases.push({
					query: q, scattered, pool: poolIndex,
					// Indices into the pool, not paths: the pools are emitted
					// once and shared, which keeps the generated file small.
					expected: scored.map(e => e.index).join(','),
				});
			}
		}
	}
}

// --- Emit --------------------------------------------------------------------

function chunkedFn(name: string, kind: string, rows: string[], perChunk = 150): string {
	const chunks: string[][] = [];
	for (let i = 0; i < rows.length; i += perChunk) { chunks.push(rows.slice(i, i + perChunk)); }
	let out = '';
	chunks.forEach((chunk, i) => {
		out += `fn ${name}Chunk${i}(cases: mut []${kind}) {\n${chunk.map(r => '    cases.push(' + r + ');').join('\n')}\n}\n\n`;
	});
	out += `export fn ${name}(): []${kind} {\n    let cases: mut []${kind} = [];\n`;
	chunks.forEach((_, i) => { out += `    ${name}Chunk${i}(cases);\n`; });
	out += '    return cases;\n}\n';
	return out;
}

let src = `// GENERATED FILE -- do not edit by hand.
//
// Every expectation below was produced by running the REAL VS Code scorer
// (src/vs/base/common/{filters,fuzzyScorer}.ts, extracted verbatim and checked
// against VS Code's own published test suite) over the corpus in
// scripts/fuzzymatch-gen/generate.ts. A failure here means the Haze port and
// VS Code disagree about a concrete input, and the case names the input.
//
// Positions are comma-joined byte offsets; spans are comma-joined
// "start-end" pairs; path lists are pipe-joined.
//
// Regenerate with:  bun run generate.ts   (see the generator's own header)

export struct ScoreCase {
    target: str = "";
    query: str = "";
    scattered: bool = true;
    score: int = 0;
    positions: str = "";
}

export struct QueryCase {
    original: str = "";
    pathNormalized: str = "";
    normalized: str = "";
    normalizedLowercase: str = "";
    expectContiguous: bool = false;
    containsSeparator: bool = false;
    values: str = "";
}

export struct ItemCase {
    label: str = "";
    description: str = "";
    path: str = "";
    query: str = "";
    scattered: bool = true;
    score: int = 0;
    labelSpans: str = "";
    descriptionSpans: str = "";
}

export struct RankCase {
    query: str = "";
    scattered: bool = true;
    // Index into rankPools().
    pool: int = 0;
    // Comma-joined indices into that pool, in the order VS Code ranks them.
    expected: str = "";
}

`;

src += chunkedFn('scoreCases', 'ScoreCase', sampledScoreCases.map(c =>
	`ScoreCase { target: ${hz(c.target)}, query: ${hz(c.query)}, scattered: ${c.scattered}, score: ${c.score}, positions: ${hz(c.positions)} }`));
src += '\n';

src += chunkedFn('queryCases', 'QueryCase', queryInputs.map(q => {
	const p = prepareQuery(q);
	const values = (p.values ?? []).map(v => v.normalized).join('|');
	return `QueryCase { original: ${hz(q)}, pathNormalized: ${hz(p.pathNormalized)}, normalized: ${hz(p.normalized)}, normalizedLowercase: ${hz(p.normalizedLowercase)}, expectContiguous: ${p.expectContiguousMatch}, containsSeparator: ${p.containsPathSeparator}, values: ${hz(values)} }`;
}));
src += '\n';

src += chunkedFn('itemCases', 'ItemCase', sampledItemCases.map(c =>
	`ItemCase { label: ${hz(c.label)}, description: ${hz(c.description)}, path: ${hz(c.path)}, query: ${hz(c.query)}, scattered: ${c.scattered}, score: ${c.score}, labelSpans: ${hz(c.labelSpans)}, descriptionSpans: ${hz(c.descriptionSpans)} }`));
src += '\n';

src += chunkedFn('rankPools', 'str', rankPools.map(pool => hz(pool.join('|'))));
src += '\n';

src += chunkedFn('rankCases', 'RankCase', rankCases.map(c =>
	`RankCase { query: ${hz(c.query)}, scattered: ${c.scattered}, pool: ${c.pool}, expected: ${hz(c.expected)} }`));

writeFileSync(process.argv[2] ?? 'cases_generated.hz', src);
console.log(`scoreCases=${sampledScoreCases.length}/${scoreCases.length} queryCases=${queryInputs.length} itemCases=${sampledItemCases.length}/${itemCases.length} rankCases=${rankCases.length}`);
