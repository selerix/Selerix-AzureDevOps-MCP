import { Readable } from "stream";

/**
 * Buffers a stream, but aborts and destroys it as soon as its content exceeds `limitBytes`
 * instead of buffering the whole thing before checking.
 */
export async function readStreamWithLimit(stream: NodeJS.ReadableStream, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limitBytes) {
      (stream as Readable).destroy();
      throw new Error(`Content is larger than the ${limitBytes / 1024} KB that can be returned inline; provide savePath to write it to disk instead.`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
