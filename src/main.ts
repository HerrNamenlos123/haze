import { ModuleCompiler } from "./ModuleCompiler";

async function main() {
  // # testCompiler = ModuleCompiler("tests/basic/basic.hz")
  // # if not testCompiler.build():
  // #     exit(1)

  // const mainCompiler = new ModuleCompiler("example.hz");
  const mainCompiler = new ModuleCompiler("test.hz");
  if (!(await mainCompiler.build())) {
    process.exit(1);
  }

  process.exit(0);
}

await main();
