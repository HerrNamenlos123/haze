# Development Guide

## Critical Patterns & Common Pitfalls

### Export System Issues

**MOST COMMON BUG PATTERN**: When implementing new features or modifying symbol data, features may work perfectly within a single module but fail when used across module boundaries.

**Root Cause**: The export serialization system in `src/SymbolCollection/Export.ts` must be updated to include any new data added to symbols.

**How It Manifests**:
- Feature works in the module where it's defined ✅
- Feature fails or appears missing when imported by other modules ❌
- Error messages about missing/incorrect data from imported symbols
- Behavior differs between local and cross-module usage

**What Happens**:
1. Parser, symbol collection, and elaboration work correctly
2. Semantic analysis has all the data within the defining module
3. But `ExportSymbol()` function doesn't serialize the new data
4. Consuming modules only see what's in the serialized `.hz` export files
5. Missing data in exports = invisible feature to consumers

**Solution Checklist**:

When adding new data to any symbol type:

1. ✅ Add to AST types (`src/shared/AST.ts`)
2. ✅ Add to collection types (`src/SymbolCollection/SymbolCollection.ts`)
3. ✅ Add to semantic types (`src/Semantic/SemanticTypes.ts`)
4. ✅ Parse in `src/Parser/Parser.ts` (if syntax change needed)
5. ✅ Collect in symbol collection
6. ✅ Elaborate in `src/Semantic/Elaborate.ts`
7. ⚠️ **UPDATE EXPORT**: Modify `ExportSymbol()` in `src/SymbolCollection/Export.ts`
8. ⚠️ **UPDATE IMPORT**: Ensure import system can parse the exported data

**Recent Example**: Default function parameters
- Parsed correctly ✅
- Collected correctly ✅
- Elaborated correctly ✅
- **Missing from exports** ❌ → caused "requires 2 arguments but 1 given" errors
- Fixed by adding default value serialization to `ExportSymbol()`

### Debugging Strategy

If a feature works locally but not across modules:
1. Check if the module defining the feature exports it
2. Look at the generated `.hz` export file in `__haze__/[module]/build/import.hz`
3. Verify the exported symbol includes all necessary data
4. If data is missing → update `src/SymbolCollection/Export.ts`

## Module System Architecture

The compiler has a two-phase import/export system:

**Phase 1: Export (Serialization)**
- Functions in `src/SymbolCollection/Export.ts` serialize semantic symbols to text
- Creates `.hz` files in `__haze__/[module]/build/import.hz`
- These files contain Haze source code representing the module's public API

**Phase 2: Import (Deserialization)**
- Importing modules parse the `.hz` files like normal source code
- Parser and symbol collection reconstruct the symbols
- No special "import deserialization" - it's just normal compilation of the export file

This is why missing export data is so problematic: the export file is missing syntax, so the import sees incomplete symbols.
