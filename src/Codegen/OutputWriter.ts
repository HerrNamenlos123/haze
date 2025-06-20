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
    const raw = value instanceof OutputWriter ? value.get() : value;

    // Match all lines, including empty ones, preserving the newline characters
    const lines = raw.match(/[^\n]*\n?|$/g);
    for (const line of lines || []) {
      if (line === "") continue; // avoid trailing empty match
      this.content += "  ".repeat(this.indent) + line;
    }

    return this;
  }

  writeLine(value: string | OutputWriter = "") {
    // If it doesn't already end in \n, we add one
    if (value instanceof OutputWriter) {
      const raw = value.get();
      return this.write(raw.endsWith("\n") ? value : raw + "\n");
    } else {
      return this.write(value.endsWith("\n") ? value : value + "\n");
    }
  }

  get() {
    return this.content;
  }
}
