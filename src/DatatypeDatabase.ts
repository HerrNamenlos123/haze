import type { Datatype, DatatypeId, Generics } from "./Datatype";
import {
  CompilerError,
  ImpossibleSituation,
  InternalError,
  Location,
} from "./Errors";
import { getDatatypeId } from "./Symbol";
import * as _ from "lodash";

export class DatatypeDatabase {
  private datatypes: { [name: string]: Datatype } = {};

  insertNew(datatype: Datatype): { id: DatatypeId; type: Datatype } {
    const id = getDatatypeId(datatype);
    if (this.datatypes[id]) {
      throw new InternalError(`Datatype ${id} already exists in database`);
    }
    this.datatypes[id] = datatype;
    return { id: id, type: datatype };
  }

  upsert(datatype: Datatype): { id: DatatypeId; type: Datatype } {
    const id = getDatatypeId(datatype);
    if (this.datatypes[id]) {
      return { id: id, type: this.datatypes[id] };
    }
    return this.insertNew(datatype);
  }

  tryLookup(id: DatatypeId): Datatype | undefined {
    const dt = this.datatypes[id];
    if (!dt) {
      return undefined;
    }
    return dt;
  }

  lookup(id: DatatypeId): Datatype {
    const dt = this.tryLookup(id);
    if (!dt) {
      throw new InternalError(`Datatype ${id} does not exist in database`);
    }
    return dt;
  }

  exists(id: DatatypeId): boolean {
    return id in this.datatypes;
  }

  instantiateDatatype(
    id: DatatypeId,
    generics: Generics,
    location: Location,
  ): { id: DatatypeId; type: Datatype } {
    const dt = _.cloneDeep(this.datatypes[id]);
    if (!dt) {
      throw new InternalError(`Datatype ${id} does not exist in database`);
    }

    switch (dt.variant) {
      case "DeferredReturn":
        throw new InternalError("Cannot instantiate __Deferred type");

      case "Struct": {
        if (Object.keys(generics).length !== Object.keys(dt.generics).length) {
          throw new CompilerError(
            `Struct ${dt.name} requires ${Object.keys(dt.generics).length} generics, but got ${Object.keys(generics).length}`,
            location,
          );
        }

        // First apply all generics
        for (const [name, datatypeId] of Object.entries(generics)) {
          if (datatypeId) {
            dt.generics[name] = datatypeId;
          }
        }

        // Insert under new id
        const { id, type } = this.upsert(dt);

        return { id, type };
      }

      case "Function": {
        if (Object.keys(generics).length !== Object.keys(dt.generics).length) {
          throw new CompilerError(
            `Function requires ${Object.keys(dt.generics).length} generics, but got ${Object.keys(generics).length}`,
            location,
          );
        }

        // First apply all generics
        for (const [name, datatypeId] of Object.entries(generics)) {
          if (datatypeId) {
            dt.generics[name] = datatypeId;
          }
        }

        // Insert under new id
        const { id, type } = this.upsert(dt);

        return { id, type };
      }

      case "RawPointer": {
        if (Object.keys(generics).length !== Object.keys(dt.generics).length) {
          throw new CompilerError(
            `RawPointer<> requires 1 generic, but got ${Object.keys(generics).length}`,
            location,
          );
        }

        // First apply all generics
        for (const [name, datatypeId] of Object.entries(generics)) {
          if (datatypeId) {
            dt.generics[name] = datatypeId;
          }
        }

        // Insert under new id
        const { id, type } = this.upsert(dt);

        return { id, type };
      }

      case "Generic":
        throw new InternalError("Cannot instantiate generic type");
      case "Primitive":
        throw new InternalError("Cannot instantiate Primitive type");
    }
    throw new ImpossibleSituation();
  }
}
