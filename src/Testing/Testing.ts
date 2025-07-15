import { compareWithDebug } from './deepCompare';

export type StageTest<I, O> = {
    name: string;
    input: I;
    expectedOutput?: O;
    shouldFail?: boolean;
};

export type StageTests<I, O> = (() => StageTest<I, O>)[];

export async function runStageTests<I, O>(
    stageName: string,
    stageFn: (input: I) => Promise<O> | O,
    tests: StageTests<I, O>
) {
    console.log(`Running tests for stage: ${stageName}`);

    for (const rawTest of tests) {
        const test = rawTest();
        try {
            const output = await stageFn(test.input);

            if (test.shouldFail) {
                console.error(`❌ [${test.name}] Expected failure but succeeded.`);
                continue;
            }

            const result = compareWithDebug(test.expectedOutput, output);
            if (!result.equal) {
                console.error(`❌ [${test.name}] Output mismatch.`);
                // console.dir({ output, expected: test.expectedOutput }, { depth: null });
                console.error(`Reason: `, result.diffs);
            } else {
                console.log(`✅ [${test.name}] Passed.`);
            }
        } catch (err) {
            if (test.shouldFail) {
                console.log(`✅ [${test.name}] Failed as expected.`);
            } else {
                console.error(`❌ [${test.name}] Unexpected failure:`, err);
            }
        }
    }
}