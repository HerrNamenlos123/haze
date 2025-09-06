import { unchangedTextChangeRange } from "typescript";
import {
  BinaryOperationToString,
  EDatatypeMutability,
  EExternLanguage,
  IncrOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, primitiveToString, type LiteralValue } from "../shared/common";
import { assert, ImpossibleSituation, InternalError } from "../shared/Errors";
import { Collect, printCollectedDatatype } from "../SymbolCollection/SymbolCollection";
import { Semantic, type SemanticResult } from "./Elaborate";

