import { runParseTests } from "./Parser/Parser.test";
// import { runSemanticTests } from "./Semantic/Semantic.test";

async function runAllTests() {
  await runParseTests();
  // await runSemanticTests();
}

runAllTests();
