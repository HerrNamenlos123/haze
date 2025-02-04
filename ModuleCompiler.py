import sys
from Parser import Parser
from colorama import Fore
from CompilationDatabase import CompilationDatabase
from Error import InternalError, CompilerError, UnreachableCode
import traceback

CXX_COMPILER = "clang++"
C_COMPILER = "clang"


class ModuleCompiler:
    def __init__(self, filename: str):
        self.filename = filename
        self.db = CompilationDatabase()

    def build(self, printSymbolTable: bool = False):
        try:
            print(f"{Fore.GREEN}Compiling{Fore.RESET} {self.filename}")
            parser = Parser(self.filename)
            ast = parser.parse()
            if not ast:
                return False

            collector = SymbolCollector(m_filename, *db)
            collector.visit(*ast)

            analyzer = SemanticAnalyzer(m_filename, *db)
            analyzer.visit(*ast)

            resolver = SymbolTypeResolver(m_filename, *db)
            resolver.visit(*ast)

            verifier = ReturnVerifier(m_filename, *db)
            verifier.visit(*ast)

            generator = CodeGenerator(m_filename, *db, llvmModule)
            generator.visit(*ast)

            # extraObjectFiles = [];
            # fs::makeDirectory(fs::cwd() / "build");
            # for (auto& unit : db->getExternalCompilationUnits()) {
            #     auto fullFilename = fs::cwd() / unit.filename;
            #     auto filename = std::filesystem::relative(std::filesystem::canonical(fullFilename), fs::cwd());
            #     std::cout << termcolor::green << "Compiling" << termcolor::reset << " " << filename.string() << std::endl;
            #     Str compiler = unit.lang == "C++" ? CXX_COMPILER : C_COMPILER;
            #     auto outname = "build/unit_" + std::to_string(extraObjectFiles.size()) + ".o";
            #     List<Str> command = { compiler, "-fPIC"s, "-c"s, "-o"s, outname, filename.string() };
            #     for (auto& flag : unit.flags) {
            #     command.push_back(flag);
            #     }
            #     extraObjectFiles.push_back(outname);

            #     try {
            #     auto code = std::system(join(command, " ").c_str());
            #     if (code != 0) {
            #         return false;
            #     }
            #     }
            #     catch (...) {
            #     return false;
            #     }
            # }

            # if (buildCxxCompatibilityLayer) {
            #     // if (!compileCxxCompatibilityLayer()) {
            #     //   return false;
            #     // }
            # }

            # m_sharedObject = {};
            # if (extraObjectFiles.size() > 0) {
            #     std::cout << termcolor::green << "Linking external files" << termcolor::reset << std::endl;
            #     m_sharedObject = fs::cwd() / "build" / "external.so";
            #     auto linkerFlags = db->getExternalLinkerFlags();
            #     try {
            #     auto code = std::system((C_COMPILER + " -shared -fPIC -o " + m_sharedObject->string() + " "
            #                             + join(extraObjectFiles, " ") + " " + join(linkerFlags, " "))
            #                                 .c_str());
            #     if (code != 0) {
            #         return false;
            #     }
            #     }
            #     catch (...) {
            #     return false;
            #     }
            # }
            return True
        except InternalError as e:
            print(e, file=sys.stderr)
        except CompilerError as e:
            print(e, file=sys.stderr)
        except UnreachableCode as e:
            print(e, file=sys.stderr)
        except Exception as e:
            print(traceback.format_exc(), file=sys.stderr)
        return False


#     def verifyAllFunctionsExist()
#         bool ret = true;

# #ifndef _WIN32
#     void* sharedObjHandle = nullptr;
#     if (m_sharedObject) {
#       sharedObjHandle = dlopen(m_sharedObject->string().c_str(), RTLD_LAZY);
#       if (!sharedObjHandle) {
#         throw CompilerError(std::format("Failed to open shared object: {}", dlerror()));
#       }
#     }

#     void* libcHandle = dlopen(nullptr, RTLD_LAZY);
#     if (!libcHandle) {
#       throw CompilerError(std::format("Failed to open libc handle: {}", dlerror()));
#     }
# #endif

#     for (auto& func : db->getExternFunctionRefs()) {
#       auto mangled = func.symbol->getMangledIdentifier();
#       if (engine->getFunctionAddress(mangled)) {
#         continue;
#       }

# #ifndef _WIN32
#       if (sharedObjHandle) {
#         if (dlsym(sharedObjHandle, mangled.c_str())) {
#           continue;
#         }
#       }

#       if (dlsym(libcHandle, mangled.c_str())) {
#         continue;
#       }
# #endif

#       printErrorMessage(func.location,
#                         std::format("Function '{}' was declared as extern but "
#                                     "is not defined in any external unit",
#                                     func.symbol->getName()));
#       ret = false;
#     }

# #ifndef _WIN32
#     if (sharedObjHandle) {
#       dlclose(sharedObjHandle);
#     }
#     dlclose(libcHandle);
# #endif

#     return ret;
#   }

#   int executeJIT(bool print = false)
#   {
#     return handleExceptions(
#         [this, print]() {
#           std::cout << termcolor::green << "Executing" << termcolor::reset << " " << m_filename << std::endl;
#           if (m_sharedObject) {
#             ::llvm::sys::DynamicLibrary::LoadLibraryPermanently(m_sharedObject->string().c_str());
#           }

#           auto engine = createExecutionEngine(std::move(llvmModule));
#           if (!verifyAllFunctionsExist(engine)) {
#             return -1;
#           }

#           auto mainFunction = getMainFunction(engine);
#           auto res = mainFunction();
#           if (print) {
#             std::cout << "Exit code: " << res << std::endl;
#           }

#           return res;
#         },
#         -1);
#   }
