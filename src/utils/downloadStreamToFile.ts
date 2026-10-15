import * as fs from "fs";
import { randomUUID } from "crypto";
import { pipeline as streamPipeline } from "stream/promises";

/**
 * Streams `contentStream` to `destPath`, writing to a collision-resistant temp sibling first and
 * moving it into place only once the write has fully succeeded. A transient failure partway
 * through therefore never truncates or clobbers any existing file at `destPath`, and two
 * concurrent downloads to the same `destPath` (opened with the exclusive `wx` flag) can't
 * clobber each other's temp file either.
 *
 * By default a file already at `destPath` is replaced. With `overwrite: false` it never is: the
 * file is created exclusively, so a file that appears at `destPath` at any moment - even after the
 * caller checked and before this finished - makes the download fail instead of replacing it.
 */
export async function downloadStreamToFile(
  contentStream: NodeJS.ReadableStream,
  destPath: string,
  options: { overwrite?: boolean } = {}
): Promise<{ savePath: string; size: number }> {
  const tempPath = `${destPath}.download-${randomUUID()}.tmp`;
  try {
    await streamPipeline(contentStream, fs.createWriteStream(tempPath, { flags: "wx" }));
    if (options.overwrite === false) {
      try {
        await fs.promises.copyFile(tempPath, destPath, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`${destPath} already exists and was not replaced`);
        }
        throw error;
      }
      await fs.promises.rm(tempPath, { force: true });
    } else {
      await fs.promises.rename(tempPath, destPath);
    }
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true });
    throw error;
  }
  const { size } = fs.statSync(destPath);
  return { savePath: destPath, size };
}
