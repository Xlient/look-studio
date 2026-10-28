const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

function decodeFrom(json: string, start: number): string {
  let out = "";
  let i = start;
  while (i < json.length) {
    const char = json[i];
    if (char === '"') {
      return out;
    }
    if (char !== "\\") {
      out += char;
      i += 1;
      continue;
    }
    const code = json[i + 1];
    if (code === undefined) {
      return out;
    }
    if (code === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        return out;
      }
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += ESCAPES[code] ?? code;
    i += 2;
  }
  return out;
}

export function readPartialString(json: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  return match === null ? null : decodeFrom(json, match.index + match[0].length);
}

export function createFieldStreamer(key: string, emit: (text: string) => void): (delta: string) => void {
  let buffer = "";
  let sent = 0;
  return (delta) => {
    buffer += delta;
    const value = readPartialString(buffer, key);
    if (value !== null && value.length > sent) {
      emit(value.slice(sent));
      sent = value.length;
    }
  };
}
