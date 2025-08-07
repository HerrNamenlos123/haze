
# 🧠 Haze Module System – Quick Reference

Haze supports **simple but powerful symbol visibility and modularity** rules, designed for fast iteration and good organization.

---

## 📦 Module Types

| Term                 | Meaning                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Compilation Unit** | The top-level hard module being compiled (e.g., a library or executable). Defined by a `haze.toml` and compiled in one go. |
| **Logical Module**   | Any folder with source files. Treated as an implicit module within a compilation unit.                                     |
| **File Scope**       | Individual `.hz` source files inside logical modules.                                                                      |

---

## 🗺️ Symbol Visibility

| Visibility | Accessible from…                            | Import Required? | Description                  |
| ---------- | ------------------------------------------- | ---------------- | ---------------------------- |
| *(none)*   | Same file                                   | ✖                | Private helper               |
| `pub`      | Same folder (logical module)                | ✖                | Shared within logical module |
| `pub`      | Another folder in the same compilation unit | ✅                | Internal import              |
| `export`   | Another compilation unit (library/user)     | ✅                | Public API                   |

---

## 📥 Import Rules

* Only **symbols** can be imported, not whole files.
* Imports use Python-style syntax:

  ```haze
  import { tokenize } from "../lexer/token.hz"
  ```
* `pub` and `export` symbols must be **declared** before being imported.

---

## 🧰 Compilation Model

* A `haze.toml` file defines the **compilation unit**.
* All logical modules (folders) within a compilation unit are **compiled together in a single pass**.
* This enables fast builds and whole-program optimization.
* Prebuilt libraries are compiled separately and only linked in.

---

## ✅ Summary

* `pub`: visible inside the same compilation unit
* `export`: visible across compilation units
* Folder = logical module
* Project root = compilation unit (defined by `haze.toml`)
* Symbol visibility is **clear**, **concise**, and **tool-friendly**

Sure! Here's a concise markdown summary for your language design reference:

---

## 🔧 Operator & Function Overloading in Haze

### 🧠 Function Overloading

* Functions can be **overloaded** by name and parameter types.
* All overloads of a function are imported together when you import a symbol.
* You don't need to reference specific overloads during import — all are included automatically.

### ➕ Operator Overloading

* Operators use **C++-style names**, like `operator+`, `operator==`, etc.
* Operators are always **methods defined inside structs**.
* There are **no global operators** — this enforces encapsulation and predictability.
* Since operators are members of a struct, **they don’t require imports** — importing the struct gives access to its operators.

### ✅ Example

```haze
struct Vec3 {
    fn operator+(other: Vec3): Vec3 {
        ...
    }

    fn operator==(other: Vec3): bool {
        ...
    }
}
```

