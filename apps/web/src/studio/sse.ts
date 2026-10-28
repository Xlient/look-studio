export interface SseEvent {
  event: string;
  data: string;
}

export function createSseParser(onEvent: (event: SseEvent) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, "\n");
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (data.length > 0) {
        onEvent({ event, data: data.join("\n") });
      }
      end = buffer.indexOf("\n\n");
    }
  };
}

export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const parse = createSseParser(onEvent);
  const decoder = new TextDecoder();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      parse(`${decoder.decode()}\n\n`);
      return;
    }
    parse(decoder.decode(value, { stream: true }));
  }
}
