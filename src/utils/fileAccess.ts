import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Rules for the local files the test execution tools read (to upload as attachments) and write
 * (to save a downloaded attachment).
 *
 * The paths come from tool arguments, which an agent fills in - and what an agent does can be
 * steered by text it has read, such as an attachment's name or a test step. Left unchecked, that
 * would let it upload a credential file (a token, an SSH key) to a project everyone can read, or
 * save an attachment over a startup file. So both directions are held to:
 *  - a list of allowed folders (by default the working directory and the system temp folder;
 *    AZURE_DEVOPS_FILE_ACCESS_DIRS replaces it, and "*" lifts the folder limit), checked on the
 *    real location, so ".." and symbolic links cannot step outside it;
 *  - a block on well-known credential and key files and folders, which applies even inside an
 *    allowed folder and even when the folder limit is lifted.
 * Downloads also never silently replace a file (see downloadStreamToFile's overwrite option).
 */

/** Raised when a path is refused; its message says why and how to allow it where that is possible. */
export class FileAccessError extends Error {}

/** Folder names that hold credentials or keys: nothing inside them is read or written. */
const SENSITIVE_FOLDERS = new Set([".ssh", ".aws", ".gnupg", ".azure", ".kube", ".docker"]);

/** File names that are credentials, tokens or private keys. */
const SENSITIVE_FILES: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production ...
  /\.env$/i, // .azuredevops.env, prod.env ...
  /^\.(npmrc|netrc|pypirc|git-credentials|pgpass)$/i,
  /^_netrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i, // private keys (the .pub files are not secret)
  /\.(pem|key|pfx|p12|jks|keystore|kdbx|ppk)$/i,
  /^authorized_keys2?$/i,
  /^known_hosts$/i,
  /^credentials(\.json)?$/i,
];

const ALLOW_ANYWHERE = "*";

/**
 * Read the list of allowed folders from a setting (separated like PATH: ";" on Windows, ":" elsewhere).
 * Returns undefined when the setting is empty, which means "use the default".
 */
export function parseAllowedDirs(value: string | undefined): string[] | undefined {
  const dirs = (value ?? "")
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);
  return dirs.length > 0 ? dirs : undefined;
}

/** The folders files may be read from and written to: the configured list, else the working directory and the temp folder. */
export function effectiveAllowedDirs(configured?: string[]): string[] {
  return configured && configured.length > 0 ? configured : [process.cwd(), os.tmpdir()];
}

function realPathOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Refuse a path that is, or sits inside, a credential or key file or folder. */
function assertNotSensitive(resolved: string): void {
  const parts = resolved.split(/[\\/]+/).filter(Boolean);
  const base = parts[parts.length - 1] ?? "";
  if (parts.slice(0, -1).some((part) => SENSITIVE_FOLDERS.has(part.toLowerCase())) || SENSITIVE_FOLDERS.has(base.toLowerCase())) {
    throw new FileAccessError(`'${resolved}' is inside a folder that holds credentials or keys, which these tools never read or write`);
  }
  if (SENSITIVE_FILES.some((pattern) => pattern.test(base))) {
    throw new FileAccessError(`'${base}' looks like a credential or key file, which these tools never read or write`);
  }
}

function assertInsideAllowed(real: string, allowedDirs: string[], verb: string): void {
  if (allowedDirs.includes(ALLOW_ANYWHERE)) {
    return;
  }
  const roots = allowedDirs.map((d) => realPathOrResolved(path.resolve(d)));
  if (!roots.some((root) => isInside(root, real))) {
    throw new FileAccessError(
      `'${real}' is outside the folders these tools may ${verb} (${roots.join(", ")}). ` +
        `Put the file in one of them, or list the folder in AZURE_DEVOPS_FILE_ACCESS_DIRS.`
    );
  }
}

/**
 * Check a local file that is about to be uploaded, and return its real path (symbolic links
 * resolved) for reading. A file that does not exist yet is checked by the path it was given.
 */
export function assertUploadAllowed(filePath: string, allowedDirs: string[]): string {
  const resolved = path.resolve(filePath);
  const real = realPathOrResolved(resolved);
  assertNotSensitive(resolved);
  assertNotSensitive(real); // a link with an innocent name to a credential file
  assertInsideAllowed(real, allowedDirs, "read");
  return real;
}

/**
 * Check a local path that is about to be written, and return the real path to write to: the real
 * location of its folder (symbolic links resolved) plus the file name. The file itself must not
 * be a symbolic link.
 */
export function assertDownloadAllowed(targetPath: string, allowedDirs: string[]): string {
  const resolved = path.resolve(targetPath);
  assertNotSensitive(resolved);

  // the real location of the nearest folder that exists, followed by the part that does not exist yet
  const rest = [path.basename(resolved)];
  let folder = path.dirname(resolved);
  while (!fs.existsSync(folder) && folder !== path.dirname(folder)) {
    rest.unshift(path.basename(folder));
    folder = path.dirname(folder);
  }
  const real = path.join(fs.realpathSync(folder), ...rest);

  try {
    if (fs.lstatSync(resolved).isSymbolicLink()) {
      throw new FileAccessError(`'${resolved}' is a symbolic link; these tools do not write through links`);
    }
  } catch (error) {
    if (error instanceof FileAccessError) throw error;
    // does not exist: fine
  }

  assertNotSensitive(real);
  assertInsideAllowed(real, allowedDirs, "write to");
  return real;
}

/**
 * A file name for saving an attachment into a folder, when the name was chosen by whoever
 * uploaded it: the attachment id in front, the name stripped of folders and odd characters, and
 * no leading dot. It can therefore never be a startup or key file such as ".bashrc" or
 * "authorized_keys", whatever the attachment is called.
 */
export function safeDownloadName(attachmentId: number, fileName: string): string {
  const base = fileName.split(/[\\/]+/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[.\s]+/, "_").slice(0, 100);
  return `${attachmentId}-${cleaned || "attachment"}`;
}
