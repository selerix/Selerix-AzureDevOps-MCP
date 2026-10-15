import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import {
  assertDownloadAllowed,
  assertUploadAllowed,
  effectiveAllowedDirs,
  FileAccessError,
  parseAllowedDirs,
  safeDownloadName
} from '../src/utils/fileAccess';
import { downloadStreamToFile } from '../src/utils/downloadStreamToFile';

describe('file access rules', () => {
  let work: string; // an allowed folder
  let outside: string; // a folder that is not allowed
  const allowed = () => [work];

  beforeEach(() => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'file-access-')));
    work = path.join(base, 'work');
    outside = path.join(base, 'outside');
    fs.mkdirSync(work);
    fs.mkdirSync(outside);
  });
  afterEach(() => {
    fs.rmSync(path.dirname(work), { recursive: true, force: true });
  });

  const touch = (file: string, content = 'x') => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  describe('the list of allowed folders', () => {
    it('is the working directory and the temp folder unless configured', () => {
      expect(effectiveAllowedDirs()).toEqual([process.cwd(), os.tmpdir()]);
      expect(effectiveAllowedDirs([])).toEqual([process.cwd(), os.tmpdir()]);
    });

    it('is exactly the configured list when there is one (it replaces the default)', () => {
      expect(effectiveAllowedDirs(['/data/attachments'])).toEqual(['/data/attachments']);
    });

    it('is read from a PATH-style setting, ignoring blanks, and is undefined when empty', () => {
      const sep = path.delimiter;
      expect(parseAllowedDirs(` /a ${sep}${sep} /b/c ${sep}`)).toEqual(['/a', '/b/c']);
      expect(parseAllowedDirs('*')).toEqual(['*']);
      expect(parseAllowedDirs('')).toBeUndefined();
      expect(parseAllowedDirs('   ')).toBeUndefined();
      expect(parseAllowedDirs(undefined)).toBeUndefined();
    });
  });

  describe('uploads (reading a file)', () => {
    it('allows a file in an allowed folder, and in a folder below it', () => {
      const a = touch(path.join(work, 'shot.png'));
      const b = touch(path.join(work, 'deep', 'er', 'log.txt'));
      expect(assertUploadAllowed(a, allowed())).toBe(fs.realpathSync(a));
      expect(assertUploadAllowed(b, allowed())).toBe(fs.realpathSync(b));
    });

    it('refuses a file outside the allowed folders, naming the folders and the setting', () => {
      const file = touch(path.join(outside, 'notes.txt'));
      expect(() => assertUploadAllowed(file, allowed())).toThrow(FileAccessError);
      expect(() => assertUploadAllowed(file, allowed())).toThrow(/outside the folders these tools may read/);
      expect(() => assertUploadAllowed(file, allowed())).toThrow('AZURE_DEVOPS_FILE_ACCESS_DIRS');
    });

    it('refuses a path that climbs out of an allowed folder with ..', () => {
      const file = touch(path.join(outside, 'notes.txt'));
      expect(() => assertUploadAllowed(path.join(work, '..', 'outside', 'notes.txt'), allowed())).toThrow(/outside the folders/);
    });

    it('does not mistake a folder that merely starts with the same letters for one inside', () => {
      const sibling = touch(path.join(path.dirname(work), 'work-evil', 'a.txt'));
      expect(() => assertUploadAllowed(sibling, allowed())).toThrow(/outside the folders/);
    });

    it('refuses a symbolic link inside an allowed folder that points outside it', () => {
      const target = touch(path.join(outside, 'secret.txt'));
      const link = path.join(work, 'innocent.txt');
      try {
        fs.symlinkSync(target, link);
      } catch {
        return; // creating links needs privileges on some systems; nothing to check there
      }
      expect(() => assertUploadAllowed(link, allowed())).toThrow(/outside the folders/);
    });

    it('lifts the folder limit with "*", but still refuses credential files', () => {
      const file = touch(path.join(outside, 'notes.txt'));
      expect(assertUploadAllowed(file, ['*'])).toBe(fs.realpathSync(file));
      expect(() => assertUploadAllowed(touch(path.join(outside, '.env')), ['*'])).toThrow(/credential or key file/);
    });

    it('checks a file that does not exist yet by the path it was given', () => {
      expect(() => assertUploadAllowed(path.join(outside, 'missing.txt'), allowed())).toThrow(/outside the folders/);
      expect(assertUploadAllowed(path.join(work, 'missing.txt'), allowed())).toBe(path.join(work, 'missing.txt'));
    });

    describe('credential and key files, even inside an allowed folder', () => {
      it.each([
        '.env', '.env.local', '.env.production', '.ENV', '.azuredevops.env', 'prod.env',
        '.npmrc', '.netrc', '_netrc', '.pypirc', '.git-credentials', '.pgpass',
        'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
        'server.pem', 'private.key', 'cert.pfx', 'store.p12', 'app.jks', 'vault.kdbx', 'putty.ppk', 'KEY.PEM',
        'authorized_keys', 'known_hosts', 'credentials', 'credentials.json'
      ])('refuses %s', (name) => {
        expect(() => assertUploadAllowed(touch(path.join(work, name)), allowed())).toThrow(/credential or key file/);
      });

      it.each(['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker'])('refuses anything inside a %s folder', (folder) => {
        expect(() => assertUploadAllowed(touch(path.join(work, folder, 'anything.txt')), allowed())).toThrow(
          /folder that holds credentials or keys/
        );
      });

      it('refuses a link with an innocent name that points at a credential file', () => {
        const secret = touch(path.join(work, '.env'));
        const link = path.join(work, 'readme.txt');
        try {
          fs.symlinkSync(secret, link);
        } catch {
          return;
        }
        expect(() => assertUploadAllowed(link, allowed())).toThrow(/credential or key file/);
      });

      it.each(['report.txt', 'screenshot.png', 'recording.mp4', 'envelope.txt', 'environment.log', 'monkey.txt', 'id_rsa.pub', 'notes.env.txt'])(
        'still allows an ordinary file such as %s',
        (name) => {
          expect(() => assertUploadAllowed(touch(path.join(work, name)), allowed())).not.toThrow();
        }
      );
    });
  });

  describe('downloads (writing a file)', () => {
    it('allows a new file in an allowed folder, and one in a folder that does not exist yet', () => {
      expect(assertDownloadAllowed(path.join(work, 'new.txt'), allowed())).toBe(path.join(work, 'new.txt'));
      expect(assertDownloadAllowed(path.join(work, 'sub', 'dir', 'new.txt'), allowed())).toBe(path.join(work, 'sub', 'dir', 'new.txt'));
    });

    it('refuses a file outside the allowed folders', () => {
      expect(() => assertDownloadAllowed(path.join(outside, 'new.txt'), allowed())).toThrow(/outside the folders these tools may write to/);
    });

    it('refuses a folder that does not exist yet when it would be outside', () => {
      expect(() => assertDownloadAllowed(path.join(outside, 'sub', 'new.txt'), allowed())).toThrow(/outside the folders/);
    });

    it('refuses to climb out with ..', () => {
      expect(() => assertDownloadAllowed(path.join(work, '..', 'outside', 'new.txt'), allowed())).toThrow(/outside the folders/);
    });

    it('refuses a folder that is a link to somewhere outside', () => {
      const link = path.join(work, 'linked');
      try {
        fs.symlinkSync(outside, link, 'junction');
      } catch {
        return;
      }
      expect(() => assertDownloadAllowed(path.join(link, 'new.txt'), allowed())).toThrow(/outside the folders/);
    });

    it('refuses to write through a symbolic link to a file', () => {
      const target = touch(path.join(work, 'real.txt'));
      const link = path.join(work, 'link.txt');
      try {
        fs.symlinkSync(target, link);
      } catch {
        return;
      }
      expect(() => assertDownloadAllowed(link, allowed())).toThrow(/symbolic link/);
    });

    it.each(['.env', 'authorized_keys', 'id_rsa', 'server.pem'])('refuses to create %s even in an allowed folder', (name) => {
      expect(() => assertDownloadAllowed(path.join(work, name), allowed())).toThrow(/credential or key file/);
    });

    it('does not treat an ordinary dotfile name as a credential: keeping those out of a folder is what safeDownloadName is for', () => {
      expect(() => assertDownloadAllowed(path.join(work, '.bashrc'), allowed())).not.toThrow();
    });

    it.each(['.ssh', '.aws', '.gnupg'])('refuses to write into a %s folder, existing or not', (folder) => {
      expect(() => assertDownloadAllowed(path.join(work, folder, 'authorized_keys'), allowed())).toThrow(/credentials or keys|credential or key file/);
      fs.mkdirSync(path.join(work, folder));
      expect(() => assertDownloadAllowed(path.join(work, folder, 'file.txt'), allowed())).toThrow(/credentials or keys/);
    });

    it('lifts the folder limit with "*", but still refuses credential files', () => {
      expect(assertDownloadAllowed(path.join(outside, 'new.txt'), ['*'])).toBe(path.join(outside, 'new.txt'));
      expect(() => assertDownloadAllowed(path.join(outside, '.env'), ['*'])).toThrow(/credential or key file/);
    });
  });

  describe('the name an attachment is saved under in a folder', () => {
    it('puts the attachment id in front, so it can never be a startup or key file name', () => {
      expect(safeDownloadName(6, 'report.txt')).toBe('6-report.txt');
      expect(safeDownloadName(6, '.bashrc')).toBe('6-_bashrc');
      expect(safeDownloadName(6, '..hidden')).toBe('6-_hidden');
      expect(safeDownloadName(9, 'authorized_keys')).toBe('9-authorized_keys');
      expect(safeDownloadName(9, 'authorized_keys')).not.toMatch(/^authorized_keys$/);
    });

    it('strips folders, however they are written', () => {
      expect(safeDownloadName(1, '../../../etc/passwd')).toBe('1-passwd');
      expect(safeDownloadName(1, '..\\..\\Windows\\system.ini')).toBe('1-system.ini');
      expect(safeDownloadName(1, '/abs/path/file.png')).toBe('1-file.png');
    });

    it('replaces odd characters and trims the length', () => {
      expect(safeDownloadName(2, 'a<b>:c|d?.txt')).toBe('2-a_b__c_d_.txt');
      expect(safeDownloadName(2, 'x'.repeat(300))).toBe(`2-${'x'.repeat(100)}`);
    });

    it('falls back to a name when nothing usable is left', () => {
      expect(safeDownloadName(3, '')).toBe('3-attachment');
      expect(safeDownloadName(3, '...')).toBe('3-_');
      expect(safeDownloadName(3, '/')).toBe('3-attachment');
    });

    it('never produces a name that a download check would refuse because of its shape', () => {
      for (const name of ['.env', '.npmrc', 'id_rsa', 'server.pem', '.ssh', 'known_hosts']) {
        const saved = safeDownloadName(5, name);
        expect(saved.startsWith('5-')).toBe(true);
        // not a bare dotfile or credential name: it carries the id prefix
        expect(saved).not.toBe(name);
        expect(saved.startsWith('.')).toBe(false);
      }
    });
  });

  describe('writing without replacing (overwrite: false)', () => {
    it('creates a new file', async () => {
      const dest = path.join(work, 'new.txt');
      const out = await downloadStreamToFile(Readable.from([Buffer.from('hello')]), dest, { overwrite: false });
      expect(fs.readFileSync(dest, 'utf8')).toBe('hello');
      expect(out.size).toBe(5);
      expect(fs.readdirSync(work)).toEqual(['new.txt']); // no temp file left behind
    });

    it('fails, and leaves the existing file untouched, when the file is already there', async () => {
      const dest = touch(path.join(work, 'keep.txt'), 'original');
      await expect(downloadStreamToFile(Readable.from([Buffer.from('new content')]), dest, { overwrite: false })).rejects.toThrow(
        /already exists and was not replaced/
      );
      expect(fs.readFileSync(dest, 'utf8')).toBe('original');
      expect(fs.readdirSync(work)).toEqual(['keep.txt']);
    });

    it('does not replace a file that appears while the download is still running', async () => {
      const dest = path.join(work, 'race.txt');
      async function* slow() {
        yield Buffer.from('part one ');
        fs.writeFileSync(dest, 'created meanwhile'); // someone else creates it mid-download
        yield Buffer.from('part two');
      }
      await expect(downloadStreamToFile(Readable.from(slow()), dest, { overwrite: false })).rejects.toThrow(/already exists/);
      expect(fs.readFileSync(dest, 'utf8')).toBe('created meanwhile');
      expect(fs.readdirSync(work)).toEqual(['race.txt']);
    });

    it('still replaces by default, as the other tools that use it expect', async () => {
      const dest = touch(path.join(work, 'replace.txt'), 'original');
      await downloadStreamToFile(Readable.from([Buffer.from('replaced')]), dest);
      expect(fs.readFileSync(dest, 'utf8')).toBe('replaced');
    });

    it('replaces when told to', async () => {
      const dest = touch(path.join(work, 'replace.txt'), 'original');
      await downloadStreamToFile(Readable.from([Buffer.from('replaced')]), dest, { overwrite: true });
      expect(fs.readFileSync(dest, 'utf8')).toBe('replaced');
    });
  });
});
