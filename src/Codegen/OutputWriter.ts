export class OutputWriter {
  private content: string = "";
  private indent: number = 0;

  constructor() {}

  pushIndent() {
    this.indent++;
    return this;
  }

  popIndent() {
    this.indent--;
    return this;
  }

  write(value: string | OutputWriter) {
    if (value instanceof OutputWriter) {
      const lines = value
        .get()
        .split("\n")
        .filter((line) => line !== "");
      for (const line of lines) {
        this.writeLine(line);
      }
    } else {
      this.content += "  ".repeat(this.indent) + value;
    }
    return this;
  }

  writeLine(value: string | OutputWriter = "") {
    this.write(value);
    this.write("\n");
    return this;
  }

  get() {
    return this.content;
  }
}
