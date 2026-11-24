// Text the compiler reads is normalized: CRLF and a lone CR become LF. Source
// code is text, so a program means the same whatever line endings its file was
// written or checked out with (a Windows checkout is CRLF), and so is what
// embed.text embeds. Only data that is not text (embed.binary) keeps its bytes.
export function normalizeLineEndings(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}
