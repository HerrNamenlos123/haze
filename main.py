from ModuleCompiler import ModuleCompiler

if __name__ == "__main__":
    testCompiler = ModuleCompiler("tests/basic/basic.hz")
    if not testCompiler.build():
        exit(1)

    mainCompiler = ModuleCompiler("example.hz")
    if not mainCompiler.build(False):
        exit(1)

    exit(mainCompiler.execute())
