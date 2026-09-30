import * as fs from "fs";
import { randomUUID } from "crypto";
import { pipeline as streamPipeline } from "stream/promises";

/**
 * Streams `contentStream` to `destPath`, writing to a collision-resistant temp sibling first and
 * renaming into place only once the write has fully succeeded. A transient failure partway
 * through therefore never truncates or clobbers any existing file at `destPath`, and two
 * concurrent downloads to the same `destPath` (opened with the exclusive `wx` flag) can't
 * clobber each other's temp file either.
 */
export async function downloadStreamToFile(
  contentStream: NodeJS.ReadableStream,
  destPath: string
): Promise<{ savePath: string; size: number }> {
  const tempPath = `${destPath}.download-${randomUUID()}.tmp`;
  try {
    await streamPipeline(contentStream, fs.createWriteStream(tempPath, { flags: "wx" }));
    await fs.promises.rename(tempPath, destPath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true });
    throw error;
  }
  const { size } = fs.statSync(destPath);
  return { savePath: destPath, size };
}
