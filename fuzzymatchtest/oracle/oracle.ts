// Self-contained extraction of VS Code's file-picker fuzzy scorer, used ONLY
// as a differential oracle to generate expected values for the Haze port.
// Sources: src/vs/base/common/{filters,fuzzyScorer,comparers}.ts (MIT).
// The handful of leaf dependencies are stubbed below for a POSIX/Linux target.

const enum CharCode {
	Tab = 9, LineFeed = 10, CarriageReturn = 13, Space = 32,
	DoubleQuote = 34, DollarSign = 36, SingleQuote = 39,
	OpenParen = 40, CloseParen = 41, Dash = 45, Period = 46, Slash = 47,
	Digit0 = 48, Digit9 = 57, Colon = 58, LessThan = 60, GreaterThan = 62,
	A = 65, Z = 90,
	OpenSquareBracket = 91, Backslash = 92, CloseSquareBracket = 93, Underline = 95,
	a = 97, z = 122,
	OpenCurlyBrace = 123, CloseCurlyBrace = 125,
}

const isWindows = false;
const isLinux = true;
const sep = '/';

const strings = {
	isEmojiImprecise(x: number): boolean {
		return (x >= 0x1F1E6 && x <= 0x1F1FF) || (x >= 0x1F300 && x <= 0x1F5FF)
			|| (x >= 0x1F600 && x <= 0x1F64F) || (x >= 0x1F680 && x <= 0x1F6FF)
			|| (x >= 0x1F900 && x <= 0x1F9FF) || (x >= 0x2600 && x <= 0x27BF);
	},
	startsWithIgnoreCase(str: string, candidate: string): boolean {
		return str.length >= candidate.length
			&& str.substr(0, candidate.length).toLowerCase() === candidate.toLowerCase();
	},
};

function equalsIgnoreCase(a: string, b: string): boolean {
	return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

function hash(obj: any): number {
	const s = JSON.stringify(obj);
	let h = 0;
	for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; }
	return h;
}

// --- comparers.ts (compareAnything / compareByPrefix), with the Intl-collator
// --- file-name comparison replaced by the plain lowercase ordering the Haze
// --- port implements. Only reachable as the last tie-break.
export function compareByPrefix(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();
	const elementAPrefixMatch = elementAName.startsWith(lookFor);
	const elementBPrefixMatch = elementBName.startsWith(lookFor);
	if (elementAPrefixMatch !== elementBPrefixMatch) {
		return elementAPrefixMatch ? -1 : 1;
	} else if (elementAPrefixMatch && elementBPrefixMatch) {
		if (elementAName.length < elementBName.length) { return -1; }
		if (elementAName.length > elementBName.length) { return 1; }
	}
	return 0;
}

export function compareAnything(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();
	const prefixCompare = compareByPrefix(one, other, lookFor);
	if (prefixCompare) { return prefixCompare; }
	const elementASuffixMatch = elementAName.endsWith(lookFor);
	const elementBSuffixMatch = elementBName.endsWith(lookFor);
	if (elementASuffixMatch !== elementBSuffixMatch) {
		return elementASuffixMatch ? -1 : 1;
	}
	if (elementAName < elementBName) { return -1; }
	if (elementAName > elementBName) { return 1; }
	return 0;
}

export interface IMatch { start: number; end: number; }

export function matchesPrefix(word: string, wordToMatchAgainst: string): IMatch[] | null {
	if (!wordToMatchAgainst || wordToMatchAgainst.length < word.length) { return null; }
	if (!strings.startsWithIgnoreCase(wordToMatchAgainst, word)) { return null; }
	return word.length > 0 ? [{ start: 0, end: word.length }] : [];
}

export function isUpper(code: number): boolean {
	return CharCode.A <= code && code <= CharCode.Z;
}
export function createFuzzyMatches(score: undefined | FuzzyScore): IMatch[] {
	if (typeof score === 'undefined') {
		return [];
	}
	const res: IMatch[] = [];
	const wordPos = score[1];
	for (let i = score.length - 1; i > 1; i--) {
		const pos = score[i] + wordPos;
		const last = res[res.length - 1];
		if (last && last.end === pos) {
			last.end = pos + 1;
		} else {
			res.push({ start: pos, end: pos + 1 });
		}
	}
	return res;
}

const _maxLen = 128;

function initTable() {
	const table: number[][] = [];
	const row: number[] = [];
	for (let i = 0; i <= _maxLen; i++) {
		row[i] = 0;
	}
	for (let i = 0; i <= _maxLen; i++) {
		table.push(row.slice(0));
	}
	return table;
}

function initArr(maxLen: number) {
	const row: number[] = [];
	for (let i = 0; i <= maxLen; i++) {
		row[i] = 0;
	}
	return row;
}

const _minWordMatchPos = initArr(2 * _maxLen); // min word position for a certain pattern position
const _maxWordMatchPos = initArr(2 * _maxLen); // max word position for a certain pattern position
const _diag = initTable(); // the length of a contiguous diagonal match
const _table = initTable();
const _arrows = <Arrow[][]>initTable();
const _debug = false;

function printTable(table: number[][], pattern: string, patternLen: number, word: string, wordLen: number): string {
	function pad(s: string, n: number, pad = ' ') {
		while (s.length < n) {
			s = pad + s;
		}
		return s;
	}
	let ret = ` |   |${word.split('').map(c => pad(c, 3)).join('|')}\n`;

	for (let i = 0; i <= patternLen; i++) {
		if (i === 0) {
			ret += ' |';
		} else {
			ret += `${pattern[i - 1]}|`;
		}
		ret += table[i].slice(0, wordLen + 1).map(n => pad(n.toString(), 3)).join('|') + '\n';
	}
	return ret;
}

function printTables(pattern: string, patternStart: number, word: string, wordStart: number): void {
	pattern = pattern.substr(patternStart);
	word = word.substr(wordStart);
	console.log(printTable(_table, pattern, pattern.length, word, word.length));
	console.log(printTable(_arrows, pattern, pattern.length, word, word.length));
	console.log(printTable(_diag, pattern, pattern.length, word, word.length));
}

function isSeparatorAtPos(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) {
		return false;
	}
	const code = value.codePointAt(index);
	switch (code) {
		case CharCode.Underline:
		case CharCode.Dash:
		case CharCode.Period:
		case CharCode.Space:
		case CharCode.Slash:
		case CharCode.Backslash:
		case CharCode.SingleQuote:
		case CharCode.DoubleQuote:
		case CharCode.Colon:
		case CharCode.DollarSign:
		case CharCode.LessThan:
		case CharCode.GreaterThan:
		case CharCode.OpenParen:
		case CharCode.CloseParen:
		case CharCode.OpenSquareBracket:
		case CharCode.CloseSquareBracket:
		case CharCode.OpenCurlyBrace:
		case CharCode.CloseCurlyBrace:
			return true;
		case undefined:
			return false;
		default:
			if (strings.isEmojiImprecise(code)) {
				return true;
			}
			return false;
	}
}

function isWhitespaceAtPos(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) {
		return false;
	}
	const code = value.charCodeAt(index);
	switch (code) {
		case CharCode.Space:
		case CharCode.Tab:
			return true;
		default:
			return false;
	}
}

function isUpperCaseAtPos(pos: number, word: string, wordLow: string): boolean {
	return word[pos] !== wordLow[pos];
}

export function isPatternInWord(patternLow: string, patternPos: number, patternLen: number, wordLow: string, wordPos: number, wordLen: number, fillMinWordPosArr = false): boolean {
	while (patternPos < patternLen && wordPos < wordLen) {
		if (patternLow[patternPos] === wordLow[wordPos]) {
			if (fillMinWordPosArr) {
				// Remember the min word position for each pattern position
				_minWordMatchPos[patternPos] = wordPos;
			}
			patternPos += 1;
		}
		wordPos += 1;
	}
	return patternPos === patternLen; // pattern must be exhausted
}

const enum Arrow { Diag = 1, Left = 2, LeftLeft = 3 }

/**
 * An array representing a fuzzy match.
 *
 * 0. the score
 * 1. the offset at which matching started
 * 2. `<match_pos_N>`
 * 3. `<match_pos_1>`
 * 4. `<match_pos_0>` etc
 */
export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]];

export namespace FuzzyScore {
	/**
	 * No matches and value `-100`
	 */
	export const Default: FuzzyScore = ([-100, 0]);

	export function isDefault(score?: FuzzyScore): score is [-100, 0] {
		return !score || (score.length === 2 && score[0] === -100 && score[1] === 0);
	}
}

export abstract class FuzzyScoreOptions {

	static default = { boostFullMatch: true, firstMatchCanBeWeak: false };

	constructor(
		readonly firstMatchCanBeWeak: boolean,
		readonly boostFullMatch: boolean,
	) { }
}

export interface FuzzyScorer {
	(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined;
}

export function fuzzyScore(pattern: string, patternLow: string, patternStart: number, word: string, wordLow: string, wordStart: number, options: FuzzyScoreOptions = FuzzyScoreOptions.default): FuzzyScore | undefined {

	const patternLen = pattern.length > _maxLen ? _maxLen : pattern.length;
	const wordLen = word.length > _maxLen ? _maxLen : word.length;

	if (patternStart >= patternLen || wordStart >= wordLen || (patternLen - patternStart) > (wordLen - wordStart)) {
		return undefined;
	}

	// Run a simple check if the characters of pattern occur
	// (in order) at all in word. If that isn't the case we
	// stop because no match will be possible
	if (!isPatternInWord(patternLow, patternStart, patternLen, wordLow, wordStart, wordLen, true)) {
		return undefined;
	}

	// Find the max matching word position for each pattern position
	// NOTE: the min matching word position was filled in above, in the `isPatternInWord` call
	_fillInMaxWordMatchPos(patternLen, wordLen, patternStart, wordStart, patternLow, wordLow);

	let row: number = 1;
	let column: number = 1;
	let patternPos = patternStart;
	let wordPos = wordStart;

	const hasStrongFirstMatch = [false];

	// There will be a match, fill in tables
	for (row = 1, patternPos = patternStart; patternPos < patternLen; row++, patternPos++) {

		// Reduce search space to possible matching word positions and to possible access from next row
		const minWordMatchPos = _minWordMatchPos[patternPos];
		const maxWordMatchPos = _maxWordMatchPos[patternPos];
		const nextMaxWordMatchPos = (patternPos + 1 < patternLen ? _maxWordMatchPos[patternPos + 1] : wordLen);

		for (column = minWordMatchPos - wordStart + 1, wordPos = minWordMatchPos; wordPos < nextMaxWordMatchPos; column++, wordPos++) {

			let score = Number.MIN_SAFE_INTEGER;
			let canComeDiag = false;

			if (wordPos <= maxWordMatchPos) {
				score = _doScore(
					pattern, patternLow, patternPos, patternStart,
					word, wordLow, wordPos, wordLen, wordStart,
					_diag[row - 1][column - 1] === 0,
					hasStrongFirstMatch
				);
			}

			let diagScore = 0;
			if (score !== Number.MIN_SAFE_INTEGER) {
				canComeDiag = true;
				diagScore = score + _table[row - 1][column - 1];
			}

			const canComeLeft = wordPos > minWordMatchPos;
			const leftScore = canComeLeft ? _table[row][column - 1] + (_diag[row][column - 1] > 0 ? -5 : 0) : 0; // penalty for a gap start

			const canComeLeftLeft = wordPos > minWordMatchPos + 1 && _diag[row][column - 1] > 0;
			const leftLeftScore = canComeLeftLeft ? _table[row][column - 2] + (_diag[row][column - 2] > 0 ? -5 : 0) : 0; // penalty for a gap start

			if (canComeLeftLeft && (!canComeLeft || leftLeftScore >= leftScore) && (!canComeDiag || leftLeftScore >= diagScore)) {
				// always prefer choosing left left to jump over a diagonal because that means a match is earlier in the word
				_table[row][column] = leftLeftScore;
				_arrows[row][column] = Arrow.LeftLeft;
				_diag[row][column] = 0;
			} else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
				// always prefer choosing left since that means a match is earlier in the word
				_table[row][column] = leftScore;
				_arrows[row][column] = Arrow.Left;
				_diag[row][column] = 0;
			} else if (canComeDiag) {
				_table[row][column] = diagScore;
				_arrows[row][column] = Arrow.Diag;
				_diag[row][column] = _diag[row - 1][column - 1] + 1;
			} else {
				throw new Error(`not possible`);
			}
		}
	}

	if (_debug) {
		printTables(pattern, patternStart, word, wordStart);
	}

	if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
		return undefined;
	}

	row--;
	column--;

	const result: FuzzyScore = [_table[row][column], wordStart];

	let backwardsDiagLength = 0;
	let maxMatchColumn = 0;

	while (row >= 1) {
		// Find the column where we go diagonally up
		let diagColumn = column;
		do {
			const arrow = _arrows[row][diagColumn];
			if (arrow === Arrow.LeftLeft) {
				diagColumn = diagColumn - 2;
			} else if (arrow === Arrow.Left) {
				diagColumn = diagColumn - 1;
			} else {
				// found the diagonal
				break;
			}
		} while (diagColumn >= 1);

		// Overturn the "forwards" decision if keeping the "backwards" diagonal would give a better match
		if (
			backwardsDiagLength > 1 // only if we would have a contiguous match of 3 characters
			&& patternLow[patternStart + row - 1] === wordLow[wordStart + column - 1] // only if we can do a contiguous match diagonally
			&& !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow) // only if the forwards chose diagonal is not an uppercase
			&& backwardsDiagLength + 1 > _diag[row][diagColumn] // only if our contiguous match would be longer than the "forwards" contiguous match
		) {
			diagColumn = column;
		}

		if (diagColumn === column) {
			// this is a contiguous match
			backwardsDiagLength++;
		} else {
			backwardsDiagLength = 1;
		}

		if (!maxMatchColumn) {
			// remember the last matched column
			maxMatchColumn = diagColumn;
		}

		row--;
		column = diagColumn - 1;
		result.push(column);
	}

	if (wordLen - wordStart === patternLen && options.boostFullMatch) {
		// the word matches the pattern with all characters!
		// giving the score a total match boost (to come up ahead other words)
		result[0] += 2;
	}

	// Add 1 penalty for each skipped character in the word
	const skippedCharsCount = maxMatchColumn - patternLen;
	result[0] -= skippedCharsCount;

	return result;
}

function _fillInMaxWordMatchPos(patternLen: number, wordLen: number, patternStart: number, wordStart: number, patternLow: string, wordLow: string) {
	let patternPos = patternLen - 1;
	let wordPos = wordLen - 1;
	while (patternPos >= patternStart && wordPos >= wordStart) {
		if (patternLow[patternPos] === wordLow[wordPos]) {
			_maxWordMatchPos[patternPos] = wordPos;
			patternPos--;
		}
		wordPos--;
	}
}

function _doScore(
	pattern: string, patternLow: string, patternPos: number, patternStart: number,
	word: string, wordLow: string, wordPos: number, wordLen: number, wordStart: number,
	newMatchStart: boolean,
	outFirstMatchStrong: boolean[],
): number {
	if (patternLow[patternPos] !== wordLow[wordPos]) {
		return Number.MIN_SAFE_INTEGER;
	}

	let score = 1;
	let isGapLocation = false;
	if (wordPos === (patternPos - patternStart)) {
		// common prefix: `foobar <-> foobaz`
		//                            ^^^^^
		score = pattern[patternPos] === word[wordPos] ? 7 : 5;

	} else if (isUpperCaseAtPos(wordPos, word, wordLow) && (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))) {
		// hitting upper-case: `foo <-> forOthers`
		//                              ^^ ^
		score = pattern[patternPos] === word[wordPos] ? 7 : 5;
		isGapLocation = true;

	} else if (isSeparatorAtPos(wordLow, wordPos) && (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))) {
		// hitting a separator: `. <-> foo.bar`
		//                                ^
		score = 5;

	} else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
		// post separator: `foo <-> bar_foo`
		//                              ^^^
		score = 5;
		isGapLocation = true;
	}

	if (score > 1 && patternPos === patternStart) {
		outFirstMatchStrong[0] = true;
	}

	if (!isGapLocation) {
		isGapLocation = isUpperCaseAtPos(wordPos, word, wordLow) || isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1);
	}

	//
	if (patternPos === patternStart) { // first character in pattern
		if (wordPos > wordStart) {
			// the first pattern character would match a word character that is not at the word start
			// so introduce a penalty to account for the gap preceding this match
			score -= isGapLocation ? 3 : 5;
		}
	} else {
		if (newMatchStart) {
			// this would be the beginning of a new match (i.e. there would be a gap before this location)
			score += isGapLocation ? 2 : 0;
		} else {
			// this is part of a contiguous match, so give it a slight bonus, but do so only if it would not be a preferred gap location
			score += isGapLocation ? 0 : 1;
		}
	}

	if (wordPos + 1 === wordLen) {
		// we always penalize gaps, but this gives unfair advantages to a match that would match the last character in the word
		// so pretend there is a gap after the last character in the word to normalize things
		score -= isGapLocation ? 3 : 5;
	}

	return score;
}



//#region Fuzzy scorer

export type FuzzyScore = [number /* score */, number[] /* match positions */];
export type FuzzyScorerCache = { [key: string]: IItemScore };

const NO_MATCH = 0;
const NO_SCORE: FuzzyScore = [NO_MATCH, []];

// const DEBUG = true;
// const DEBUG_MATRIX = false;

export function scoreFuzzy(target: string, query: string, queryLower: string, allowNonContiguousMatches: boolean): FuzzyScore {
	if (!target || !query) {
		return NO_SCORE; // return early if target or query are undefined
	}

	const targetLength = target.length;
	const queryLength = query.length;

	if (targetLength < queryLength) {
		return NO_SCORE; // impossible for query to be contained in target
	}

	// if (DEBUG) {
	// 	console.group(`Target: ${target}, Query: ${query}`);
	// }

	const targetLower = target.toLowerCase();
	const res = doScoreFuzzy(query, queryLower, queryLength, target, targetLower, targetLength, allowNonContiguousMatches);

	// if (DEBUG) {
	// 	console.log(`%cFinal Score: ${res[0]}`, 'font-weight: bold');
	// 	console.groupEnd();
	// }

	return res;
}

function doScoreFuzzy(query: string, queryLower: string, queryLength: number, target: string, targetLower: string, targetLength: number, allowNonContiguousMatches: boolean): FuzzyScore {
	const scores: number[] = [];
	const matches: number[] = [];

	//
	// Build Scorer Matrix:
	//
	// The matrix is composed of query q and target t. For each index we score
	// q[i] with t[i] and compare that with the previous score. If the score is
	// equal or larger, we keep the match. In addition to the score, we also keep
	// the length of the consecutive matches to use as boost for the score.
	//
	//      t   a   r   g   e   t
	//  q
	//  u
	//  e
	//  r
	//  y
	//
	for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
		const queryIndexOffset = queryIndex * targetLength;
		const queryIndexPreviousOffset = queryIndexOffset - targetLength;

		const queryIndexGtNull = queryIndex > 0;

		const queryCharAtIndex = query[queryIndex];
		const queryLowerCharAtIndex = queryLower[queryIndex];

		for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
			const targetIndexGtNull = targetIndex > 0;

			const currentIndex = queryIndexOffset + targetIndex;
			const leftIndex = currentIndex - 1;
			const diagIndex = queryIndexPreviousOffset + targetIndex - 1;

			const leftScore = targetIndexGtNull ? scores[leftIndex] : 0;
			const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex] : 0;

			const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex] : 0;

			// If we are not matching on the first query character any more, we only produce a
			// score if we had a score previously for the last query index (by looking at the diagScore).
			// This makes sure that the query always matches in sequence on the target. For example
			// given a target of "ede" and a query of "de", we would otherwise produce a wrong high score
			// for query[1] ("e") matching on target[0] ("e") because of the "beginning of word" boost.
			let score: number;
			if (!diagScore && queryIndexGtNull) {
				score = 0;
			} else {
				score = computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength);
			}

			// We have a score and its equal or larger than the left score
			// Match: sequence continues growing from previous diag value
			// Score: increases by diag score value
			const isValidScore = score && diagScore + score >= leftScore;
			if (isValidScore && (
				// We don't need to check if it's contiguous if we allow non-contiguous matches
				allowNonContiguousMatches ||
				// We must be looking for a contiguous match.
				// Looking at an index higher than 0 in the query means we must have already
				// found out this is contiguous otherwise there wouldn't have been a score
				queryIndexGtNull ||
				// lastly check if the query is completely contiguous at this index in the target
				targetLower.startsWith(queryLower, targetIndex)
			)) {
				matches[currentIndex] = matchesSequenceLength + 1;
				scores[currentIndex] = diagScore + score;
			}

			// We either have no score or the score is lower than the left score
			// Match: reset to 0
			// Score: pick up from left hand side
			else {
				matches[currentIndex] = NO_MATCH;
				scores[currentIndex] = leftScore;
			}
		}
	}

	// Restore Positions (starting from bottom right of matrix)
	const positions: number[] = [];
	let queryIndex = queryLength - 1;
	let targetIndex = targetLength - 1;
	while (queryIndex >= 0 && targetIndex >= 0) {
		const currentIndex = queryIndex * targetLength + targetIndex;
		const match = matches[currentIndex];
		if (match === NO_MATCH) {
			targetIndex--; // go left
		} else {
			positions.push(targetIndex);

			// go up and left
			queryIndex--;
			targetIndex--;
		}
	}

	// Print matrix
	// if (DEBUG_MATRIX) {
	// 	printMatrix(query, target, matches, scores);
	// }

	return [scores[queryLength * targetLength - 1], positions.reverse()];
}

function computeCharScore(queryCharAtIndex: string, queryLowerCharAtIndex: string, target: string, targetLower: string, targetIndex: number, matchesSequenceLength: number): number {
	let score = 0;

	if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex])) {
		return score; // no match of characters
	}

	// if (DEBUG) {
	// 	console.groupCollapsed(`%cFound a match of char: ${queryLowerCharAtIndex} at index ${targetIndex}`, 'font-weight: normal');
	// }

	// Character match bonus
	score += 1;

	// if (DEBUG) {
	// 	console.log(`%cCharacter match bonus: +1`, 'font-weight: normal');
	// }

	// Consecutive match bonus: sequences up to 3 get the full bonus (6)
	// and the remainder gets half the bonus (3). This helps reduce the
	// overall boost for long sequence matches.
	if (matchesSequenceLength > 0) {
		score += (Math.min(matchesSequenceLength, 3) * 6) + (Math.max(0, matchesSequenceLength - 3) * 3);

		// if (DEBUG) {
		// 	console.log(`Consecutive match bonus: +${matchesSequenceLength * 5}`);
		// }
	}

	// Same case bonus
	if (queryCharAtIndex === target[targetIndex]) {
		score += 1;

		// if (DEBUG) {
		// 	console.log('Same case bonus: +1');
		// }
	}

	// Start of word bonus
	if (targetIndex === 0) {
		score += 8;

		// if (DEBUG) {
		// 	console.log('Start of word bonus: +8');
		// }
	}

	else {

		// After separator bonus
		const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1));
		if (separatorBonus) {
			score += separatorBonus;

			// if (DEBUG) {
			// 	console.log(`After separator bonus: +${separatorBonus}`);
			// }
		}

		// Inside word upper case bonus (camel case). We only give this bonus if we're not in a contiguous sequence.
		// For example:
		// NPE => NullPointerException = boost
		// HTTP => HTTP = not boost
		else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) {
			score += 2;

			// if (DEBUG) {
			// 	console.log('Inside word upper case bonus: +2');
			// }
		}
	}

	// if (DEBUG) {
	// 	console.log(`Total score: ${score}`);
	// 	console.groupEnd();
	// }

	return score;
}

function considerAsEqual(a: string, b: string): boolean {
	if (a === b) {
		return true;
	}

	// Special case path separators: ignore platform differences
	if (a === '/' || a === '\\') {
		return b === '/' || b === '\\';
	}

	return false;
}

function scoreSeparatorAtPos(charCode: number): number {
	switch (charCode) {
		case CharCode.Slash:
		case CharCode.Backslash:
			return 5; // prefer path separators...
		case CharCode.Underline:
		case CharCode.Dash:
		case CharCode.Period:
		case CharCode.Space:
		case CharCode.SingleQuote:
		case CharCode.DoubleQuote:
		case CharCode.Colon:
			return 4; // ...over other separators
		default:
			return 0;
	}
}

// function printMatrix(query: string, target: string, matches: number[], scores: number[]): void {
// 	console.log('\t' + target.split('').join('\t'));
// 	for (let queryIndex = 0; queryIndex < query.length; queryIndex++) {
// 		let line = query[queryIndex] + '\t';
// 		for (let targetIndex = 0; targetIndex < target.length; targetIndex++) {
// 			const currentIndex = queryIndex * target.length + targetIndex;
// 			line = line + 'M' + matches[currentIndex] + '/' + 'S' + scores[currentIndex] + '\t';
// 		}

// 		console.log(line);
// 	}
// }

//#endregion


//#region Alternate fuzzy scorer implementation that is e.g. used for symbols

export type FuzzyScore2 = [number | undefined /* score */, IMatch[]];

const NO_SCORE2: FuzzyScore2 = [undefined, []];

export function scoreFuzzy2(target: string, query: IPreparedQuery | IPreparedQueryPiece, patternStart = 0, wordStart = 0): FuzzyScore2 {

	// Score: multiple inputs
	const preparedQuery = query as IPreparedQuery;
	if (preparedQuery.values && preparedQuery.values.length > 1) {
		return doScoreFuzzy2Multiple(target, preparedQuery.values, patternStart, wordStart);
	}

	// Score: single input
	return doScoreFuzzy2Single(target, query, patternStart, wordStart);
}

function doScoreFuzzy2Multiple(target: string, query: IPreparedQueryPiece[], patternStart: number, wordStart: number): FuzzyScore2 {
	let totalScore = 0;
	const totalMatches: IMatch[] = [];

	for (const queryPiece of query) {
		const [score, matches] = doScoreFuzzy2Single(target, queryPiece, patternStart, wordStart);
		if (typeof score !== 'number') {
			// if a single query value does not match, return with
			// no score entirely, we require all queries to match
			return NO_SCORE2;
		}

		totalScore += score;
		totalMatches.push(...matches);
	}

	// if we have a score, ensure that the positions are
	// sorted in ascending order and distinct
	return [totalScore, normalizeMatches(totalMatches)];
}

function doScoreFuzzy2Single(target: string, query: IPreparedQueryPiece, patternStart: number, wordStart: number): FuzzyScore2 {
	const score = fuzzyScore(query.normalized, query.normalizedLowercase, patternStart, target, target.toLowerCase(), wordStart, { firstMatchCanBeWeak: true, boostFullMatch: true });
	if (!score) {
		return NO_SCORE2;
	}

	return [score[0], createFuzzyMatches(score)];
}

//#endregion


//#region Item (label, description, path) scorer

/**
 * Scoring on structural items that have a label and optional description.
 */
export interface IItemScore {

	/**
	 * Overall score.
	 */
	score: number;

	/**
	 * Matches within the label.
	 */
	labelMatch?: IMatch[];

	/**
	 * Matches within the description.
	 */
	descriptionMatch?: IMatch[];
}

const NO_ITEM_SCORE = Object.freeze<IItemScore>({ score: 0 });

export interface IItemAccessor<T> {

	/**
	 * Just the label of the item to score on.
	 */
	getItemLabel(item: T): string | undefined;

	/**
	 * The optional description of the item to score on.
	 */
	getItemDescription(item: T): string | undefined;

	/**
	 * If the item is a file, the path of the file to score on.
	 */
	getItemPath(file: T): string | undefined;
}

const PATH_IDENTITY_SCORE = 1 << 18;
const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17;
const LABEL_SCORE_THRESHOLD = 1 << 16;

function getCacheHash(label: string, description: string | undefined, allowNonContiguousMatches: boolean, query: IPreparedQuery) {
	const values = query.values ? query.values : [query];
	const cacheHash = hash({
		[query.normalized]: {
			values: values.map(v => ({ value: v.normalized, expectContiguousMatch: v.expectContiguousMatch })),
			label,
			description,
			allowNonContiguousMatches
		}
	});
	return cacheHash;
}

export function scoreItemFuzzy<T>(item: T, query: IPreparedQuery, allowNonContiguousMatches: boolean, accessor: IItemAccessor<T>, cache: FuzzyScorerCache): IItemScore {
	if (!item || !query.normalized) {
		return NO_ITEM_SCORE; // we need an item and query to score on at least
	}

	const label = accessor.getItemLabel(item);
	if (!label) {
		return NO_ITEM_SCORE; // we need a label at least
	}

	const description = accessor.getItemDescription(item);

	// in order to speed up scoring, we cache the score with a unique hash based on:
	// - label
	// - description (if provided)
	// - whether non-contiguous matching is enabled or not
	// - hash of the query (normalized) values
	const cacheHash = getCacheHash(label, description, allowNonContiguousMatches, query);
	const cached = cache[cacheHash];
	if (cached) {
		return cached;
	}

	const itemScore = doScoreItemFuzzy(label, description, accessor.getItemPath(item), query, allowNonContiguousMatches);
	cache[cacheHash] = itemScore;

	return itemScore;
}

function doScoreItemFuzzy(label: string, description: string | undefined, path: string | undefined, query: IPreparedQuery, allowNonContiguousMatches: boolean): IItemScore {
	const preferLabelMatches = !path || !query.containsPathSeparator;

	// Treat identity matches on full path highest
	if (path && (isLinux ? query.pathNormalized === path : equalsIgnoreCase(query.pathNormalized, path))) {
		return { score: PATH_IDENTITY_SCORE, labelMatch: [{ start: 0, end: label.length }], descriptionMatch: description ? [{ start: 0, end: description.length }] : undefined };
	}

	// Score: multiple inputs
	if (query.values && query.values.length > 1) {
		return doScoreItemFuzzyMultiple(label, description, path, query.values, preferLabelMatches, allowNonContiguousMatches);
	}

	// Score: single input
	return doScoreItemFuzzySingle(label, description, path, query, preferLabelMatches, allowNonContiguousMatches);
}

function doScoreItemFuzzyMultiple(label: string, description: string | undefined, path: string | undefined, query: IPreparedQueryPiece[], preferLabelMatches: boolean, allowNonContiguousMatches: boolean): IItemScore {
	let totalScore = 0;
	const totalLabelMatches: IMatch[] = [];
	const totalDescriptionMatches: IMatch[] = [];

	for (const queryPiece of query) {
		const { score, labelMatch, descriptionMatch } = doScoreItemFuzzySingle(label, description, path, queryPiece, preferLabelMatches, allowNonContiguousMatches);
		if (score === NO_MATCH) {
			// if a single query value does not match, return with
			// no score entirely, we require all queries to match
			return NO_ITEM_SCORE;
		}

		totalScore += score;
		if (labelMatch) {
			totalLabelMatches.push(...labelMatch);
		}

		if (descriptionMatch) {
			totalDescriptionMatches.push(...descriptionMatch);
		}
	}

	// if we have a score, ensure that the positions are
	// sorted in ascending order and distinct
	return {
		score: totalScore,
		labelMatch: normalizeMatches(totalLabelMatches),
		descriptionMatch: normalizeMatches(totalDescriptionMatches)
	};
}

function doScoreItemFuzzySingle(label: string, description: string | undefined, path: string | undefined, query: IPreparedQueryPiece, preferLabelMatches: boolean, allowNonContiguousMatches: boolean): IItemScore {

	// Prefer label matches if told so or we have no description
	if (preferLabelMatches || !description) {
		const [labelScore, labelPositions] = scoreFuzzy(
			label,
			query.normalized,
			query.normalizedLowercase,
			allowNonContiguousMatches && !query.expectContiguousMatch);
		if (labelScore) {

			// If we have a prefix match on the label, we give a much
			// higher baseScore to elevate these matches over others
			// This ensures that typing a file name wins over results
			// that are present somewhere in the label, but not the
			// beginning.
			const labelPrefixMatch = matchesPrefix(query.normalized, label);
			let baseScore: number;
			if (labelPrefixMatch) {
				baseScore = LABEL_PREFIX_SCORE_THRESHOLD;

				// We give another boost to labels that are short, e.g. given
				// files "window.ts" and "windowActions.ts" and a query of
				// "window", we want "window.ts" to receive a higher score.
				// As such we compute the percentage the query has within the
				// label and add that to the baseScore.
				const prefixLengthBoost = Math.round((query.normalized.length / label.length) * 100);
				baseScore += prefixLengthBoost;
			} else {
				baseScore = LABEL_SCORE_THRESHOLD;
			}

			return { score: baseScore + labelScore, labelMatch: labelPrefixMatch || createMatches(labelPositions) };
		}
	}

	// Finally compute description + label scores if we have a description
	if (description) {
		let descriptionPrefix = description;
		if (!!path) {
			descriptionPrefix = `${description}${sep}`; // assume this is a file path
		}

		const descriptionPrefixLength = descriptionPrefix.length;
		const descriptionAndLabel = `${descriptionPrefix}${label}`;

		const [labelDescriptionScore, labelDescriptionPositions] = scoreFuzzy(
			descriptionAndLabel,
			query.normalized,
			query.normalizedLowercase,
			allowNonContiguousMatches && !query.expectContiguousMatch);
		if (labelDescriptionScore) {
			const labelDescriptionMatches = createMatches(labelDescriptionPositions);
			const labelMatch: IMatch[] = [];
			const descriptionMatch: IMatch[] = [];

			// We have to split the matches back onto the label and description portions
			labelDescriptionMatches.forEach(h => {

				// Match overlaps label and description part, we need to split it up
				if (h.start < descriptionPrefixLength && h.end > descriptionPrefixLength) {
					labelMatch.push({ start: 0, end: h.end - descriptionPrefixLength });
					descriptionMatch.push({ start: h.start, end: descriptionPrefixLength });
				}

				// Match on label part
				else if (h.start >= descriptionPrefixLength) {
					labelMatch.push({ start: h.start - descriptionPrefixLength, end: h.end - descriptionPrefixLength });
				}

				// Match on description part
				else {
					descriptionMatch.push(h);
				}
			});

			return { score: labelDescriptionScore, labelMatch, descriptionMatch };
		}
	}

	return NO_ITEM_SCORE;
}

function createMatches(offsets: number[] | undefined): IMatch[] {
	const ret: IMatch[] = [];
	if (!offsets) {
		return ret;
	}

	let last: IMatch | undefined;
	for (const pos of offsets) {
		if (last && last.end === pos) {
			last.end += 1;
		} else {
			last = { start: pos, end: pos + 1 };
			ret.push(last);
		}
	}

	return ret;
}

function normalizeMatches(matches: IMatch[]): IMatch[] {

	// sort matches by start to be able to normalize
	const sortedMatches = matches.sort((matchA, matchB) => {
		return matchA.start - matchB.start;
	});

	// merge matches that overlap
	const normalizedMatches: IMatch[] = [];
	let currentMatch: IMatch | undefined = undefined;
	for (const match of sortedMatches) {

		// if we have no current match or the matches
		// do not overlap, we take it as is and remember
		// it for future merging
		if (!currentMatch || !matchOverlaps(currentMatch, match)) {
			currentMatch = match;
			normalizedMatches.push(match);
		}

		// otherwise we merge the matches
		else {
			currentMatch.start = Math.min(currentMatch.start, match.start);
			currentMatch.end = Math.max(currentMatch.end, match.end);
		}
	}

	return normalizedMatches;
}

function matchOverlaps(matchA: IMatch, matchB: IMatch): boolean {
	if (matchA.end < matchB.start) {
		return false;	// A ends before B starts
	}

	if (matchB.end < matchA.start) {
		return false; // B ends before A starts
	}

	return true;
}

//#endregion


//#region Comparers

export function compareItemsByFuzzyScore<T>(itemA: T, itemB: T, query: IPreparedQuery, allowNonContiguousMatches: boolean, accessor: IItemAccessor<T>, cache: FuzzyScorerCache): number {
	const itemScoreA = scoreItemFuzzy(itemA, query, allowNonContiguousMatches, accessor, cache);
	const itemScoreB = scoreItemFuzzy(itemB, query, allowNonContiguousMatches, accessor, cache);

	const scoreA = itemScoreA.score;
	const scoreB = itemScoreB.score;

	// 1.) identity matches have highest score
	if (scoreA === PATH_IDENTITY_SCORE || scoreB === PATH_IDENTITY_SCORE) {
		if (scoreA !== scoreB) {
			return scoreA === PATH_IDENTITY_SCORE ? -1 : 1;
		}
	}

	// 2.) matches on label are considered higher compared to label+description matches
	if (scoreA > LABEL_SCORE_THRESHOLD || scoreB > LABEL_SCORE_THRESHOLD) {
		if (scoreA !== scoreB) {
			return scoreA > scoreB ? -1 : 1;
		}

		// prefer more compact matches over longer in label (unless this is a prefix match where
		// longer prefix matches are actually preferred)
		if (scoreA < LABEL_PREFIX_SCORE_THRESHOLD && scoreB < LABEL_PREFIX_SCORE_THRESHOLD) {
			const comparedByMatchLength = compareByMatchLength(itemScoreA.labelMatch, itemScoreB.labelMatch);
			if (comparedByMatchLength !== 0) {
				return comparedByMatchLength;
			}
		}

		// prefer shorter labels over longer labels
		const labelA = accessor.getItemLabel(itemA) || '';
		const labelB = accessor.getItemLabel(itemB) || '';
		if (labelA.length !== labelB.length) {
			return labelA.length - labelB.length;
		}
	}

	// 3.) compare by score in label+description
	if (scoreA !== scoreB) {
		return scoreA > scoreB ? -1 : 1;
	}

	// 4.) scores are identical: prefer matches in label over non-label matches
	const itemAHasLabelMatches = Array.isArray(itemScoreA.labelMatch) && itemScoreA.labelMatch.length > 0;
	const itemBHasLabelMatches = Array.isArray(itemScoreB.labelMatch) && itemScoreB.labelMatch.length > 0;
	if (itemAHasLabelMatches && !itemBHasLabelMatches) {
		return -1;
	} else if (itemBHasLabelMatches && !itemAHasLabelMatches) {
		return 1;
	}

	// 5.) scores are identical: prefer more compact matches (label and description)
	const itemAMatchDistance = computeLabelAndDescriptionMatchDistance(itemA, itemScoreA, accessor);
	const itemBMatchDistance = computeLabelAndDescriptionMatchDistance(itemB, itemScoreB, accessor);
	if (itemAMatchDistance && itemBMatchDistance && itemAMatchDistance !== itemBMatchDistance) {
		return itemBMatchDistance > itemAMatchDistance ? -1 : 1;
	}

	// 6.) scores are identical: start to use the fallback compare
	return fallbackCompare(itemA, itemB, query, accessor);
}

function computeLabelAndDescriptionMatchDistance<T>(item: T, score: IItemScore, accessor: IItemAccessor<T>): number {
	let matchStart = -1;
	let matchEnd = -1;

	// If we have description matches, the start is first of description match
	if (score.descriptionMatch?.length) {
		matchStart = score.descriptionMatch[0].start;
	}

	// Otherwise, the start is the first label match
	else if (score.labelMatch?.length) {
		matchStart = score.labelMatch[0].start;
	}

	// If we have label match, the end is the last label match
	// If we had a description match, we add the length of the description
	// as offset to the end to indicate this.
	if (score.labelMatch?.length) {
		matchEnd = score.labelMatch[score.labelMatch.length - 1].end;
		if (score.descriptionMatch?.length) {
			const itemDescription = accessor.getItemDescription(item);
			if (itemDescription) {
				matchEnd += itemDescription.length;
			}
		}
	}

	// If we have just a description match, the end is the last description match
	else if (score.descriptionMatch?.length) {
		matchEnd = score.descriptionMatch[score.descriptionMatch.length - 1].end;
	}

	return matchEnd - matchStart;
}

function compareByMatchLength(matchesA?: IMatch[], matchesB?: IMatch[]): number {
	if ((!matchesA && !matchesB) || ((!matchesA?.length) && (!matchesB?.length))) {
		return 0; // make sure to not cause bad comparing when matches are not provided
	}

	if (!matchesB?.length) {
		return -1;
	}

	if (!matchesA?.length) {
		return 1;
	}

	// Compute match length of A (first to last match)
	const matchStartA = matchesA[0].start;
	const matchEndA = matchesA[matchesA.length - 1].end;
	const matchLengthA = matchEndA - matchStartA;

	// Compute match length of B (first to last match)
	const matchStartB = matchesB[0].start;
	const matchEndB = matchesB[matchesB.length - 1].end;
	const matchLengthB = matchEndB - matchStartB;

	// Prefer shorter match length
	return matchLengthA === matchLengthB ? 0 : matchLengthB < matchLengthA ? 1 : -1;
}

function fallbackCompare<T>(itemA: T, itemB: T, query: IPreparedQuery, accessor: IItemAccessor<T>): number {

	// check for label + description length and prefer shorter
	const labelA = accessor.getItemLabel(itemA) || '';
	const labelB = accessor.getItemLabel(itemB) || '';

	const descriptionA = accessor.getItemDescription(itemA);
	const descriptionB = accessor.getItemDescription(itemB);

	const labelDescriptionALength = labelA.length + (descriptionA ? descriptionA.length : 0);
	const labelDescriptionBLength = labelB.length + (descriptionB ? descriptionB.length : 0);

	if (labelDescriptionALength !== labelDescriptionBLength) {
		return labelDescriptionALength - labelDescriptionBLength;
	}

	// check for path length and prefer shorter
	const pathA = accessor.getItemPath(itemA);
	const pathB = accessor.getItemPath(itemB);

	if (pathA && pathB && pathA.length !== pathB.length) {
		return pathA.length - pathB.length;
	}

	// 7.) finally we have equal scores and equal length, we fallback to comparer

	// compare by label
	if (labelA !== labelB) {
		return compareAnything(labelA, labelB, query.normalized);
	}

	// compare by description
	if (descriptionA && descriptionB && descriptionA !== descriptionB) {
		return compareAnything(descriptionA, descriptionB, query.normalized);
	}

	// compare by path
	if (pathA && pathB && pathA !== pathB) {
		return compareAnything(pathA, pathB, query.normalized);
	}

	// equal
	return 0;
}

//#endregion


//#region Query Normalizer

export interface IPreparedQueryPiece {

	/**
	 * The original query as provided as input.
	 */
	original: string;
	originalLowercase: string;

	/**
	 * Original normalized to platform separators:
	 * - Windows: \
	 * - Posix: /
	 */
	pathNormalized: string;

	/**
	 * In addition to the normalized path, will have
	 * whitespace, wildcards, quotes, ellipsis, and trailing hash characters removed.
	 */
	normalized: string;
	normalizedLowercase: string;

	/**
	 * The query is wrapped in quotes which means
	 * this query must be a substring of the input.
	 * In other words, no fuzzy matching is used.
	 */
	expectContiguousMatch: boolean;
}

export interface IPreparedQuery extends IPreparedQueryPiece {

	/**
	 * Query split by spaces into pieces.
	 */
	values: IPreparedQueryPiece[] | undefined;

	/**
	 * Whether the query contains path separator(s) or not.
	 */
	containsPathSeparator: boolean;
}

/*
 * If a query is wrapped in quotes, the user does not want to
 * use fuzzy search for this query.
 */
function queryExpectsExactMatch(query: string) {
	return query.startsWith('"') && query.endsWith('"');
}

/**
 * Helper function to prepare a search value for scoring by removing unwanted characters
 * and allowing to score on multiple pieces separated by whitespace character.
 */
const MULTIPLE_QUERY_VALUES_SEPARATOR = ' ';
export function prepareQuery(original: string): IPreparedQuery {
	if (typeof original !== 'string') {
		original = '';
	}

	const originalLowercase = original.toLowerCase();
	const { pathNormalized, normalized, normalizedLowercase } = normalizeQuery(original);
	const containsPathSeparator = pathNormalized.indexOf(sep) >= 0;
	const expectExactMatch = queryExpectsExactMatch(original);

	let values: IPreparedQueryPiece[] | undefined = undefined;

	const originalSplit = original.split(MULTIPLE_QUERY_VALUES_SEPARATOR);
	if (originalSplit.length > 1) {
		for (const originalPiece of originalSplit) {
			const expectExactMatchPiece = queryExpectsExactMatch(originalPiece);
			const {
				pathNormalized: pathNormalizedPiece,
				normalized: normalizedPiece,
				normalizedLowercase: normalizedLowercasePiece
			} = normalizeQuery(originalPiece);

			if (normalizedPiece) {
				if (!values) {
					values = [];
				}

				values.push({
					original: originalPiece,
					originalLowercase: originalPiece.toLowerCase(),
					pathNormalized: pathNormalizedPiece,
					normalized: normalizedPiece,
					normalizedLowercase: normalizedLowercasePiece,
					expectContiguousMatch: expectExactMatchPiece
				});
			}
		}
	}

	return { original, originalLowercase, pathNormalized, normalized, normalizedLowercase, values, containsPathSeparator, expectContiguousMatch: expectExactMatch };
}

function normalizeQuery(original: string): { pathNormalized: string; normalized: string; normalizedLowercase: string } {
	let pathNormalized: string;
	if (isWindows) {
		pathNormalized = original.replace(/\//g, sep); // Help Windows users to search for paths when using slash
	} else {
		pathNormalized = original.replace(/\\/g, sep); // Help macOS/Linux users to search for paths when using backslash
	}

	// remove certain characters that help find better results:
	// - quotes: are used for exact match search
	// - wildcards: are used for fuzzy matching
	// - whitespace: are used to separate queries
	// - ellipsis: sometimes used to indicate any path segments
	// - trailing hash: used by some language servers (e.g. rust-analyzer) as query modifiers
	const normalized = pathNormalized.replace(/[\*\u2026\s"]/g, '').replace(/(?<=.)#$/, '');

	return {
		pathNormalized,
		normalized,
		normalizedLowercase: normalized.toLowerCase()
	};
}

export function pieceToQuery(piece: IPreparedQueryPiece): IPreparedQuery;
export function pieceToQuery(pieces: IPreparedQueryPiece[]): IPreparedQuery;
export function pieceToQuery(arg1: IPreparedQueryPiece | IPreparedQueryPiece[]): IPreparedQuery {
	if (Array.isArray(arg1)) {
		return prepareQuery(arg1.map(piece => piece.original).join(MULTIPLE_QUERY_VALUES_SEPARATOR));
	}

	return prepareQuery(arg1.original);
}

//#endregion
