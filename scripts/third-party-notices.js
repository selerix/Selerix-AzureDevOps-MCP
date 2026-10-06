#!/usr/bin/env node
// Writes the license texts of every third-party package esbuild bundled into dist/index.js.
// The bundle redistributes those packages' code, so their notices must ship with it.
// Usage: node scripts/third-party-notices.js <esbuild metafile> <output file>

const fs = require('fs');
const path = require('path');

const [metafilePath, outputPath] = process.argv.slice(2);
if (!metafilePath || !outputPath) {
  console.error('Usage: node scripts/third-party-notices.js <esbuild metafile> <output file>');
  process.exit(1);
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

// Some packages keep their license only in a README "License" section; return that section.
function readmeLicenseSection(dir) {
  const readme = fs.readdirSync(dir).find((f) => /^readme(\..*)?$/i.test(f));
  if (!readme) return null;
  const lines = fs.readFileSync(path.join(dir, readme), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^#+\s*licen[cs]e\b/i.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#+\s/.test(l) && l.match(/^#+/)[0].length <= level);
  return rest.slice(0, end < 0 ? rest.length : end).join('\n').trim() || null;
}

// Map each bundled input file to the root directory of the package it came from.
const packageDirs = new Set();
const meta = JSON.parse(fs.readFileSync(metafilePath, 'utf8'));
for (const input of Object.keys(meta.inputs)) {
  const parts = input.split(/[\\/]/);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0) continue;
  const nameLength = parts[i + 1].startsWith('@') ? 2 : 1;
  packageDirs.add(parts.slice(0, i + 1 + nameLength).join('/'));
}

const packages = [...packageDirs].map((dir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string'
    ? pkg.license
    : (pkg.licenses || [pkg.license]).filter(Boolean).map((l) => l.type || l).join(' OR ') || 'UNKNOWN';
  const licenseFiles = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  return { name: pkg.name, version: pkg.version, license, dir, licenseFiles };
}).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const separator = '-'.repeat(80);
const sections = packages.map((p) => {
  const header = `${p.name}@${p.version}\nLicense: ${p.license}`;
  const fromReadme = p.licenseFiles.length ? null : readmeLicenseSection(p.dir);
  const texts = p.licenseFiles.length
    ? p.licenseFiles.map((f) => fs.readFileSync(path.join(p.dir, f), 'utf8').trim())
    : [fromReadme
      ? `(License section of the package README)\n\n${fromReadme}`
      : `This package ships no license file; its package.json declares the license as ${p.license}.`];
  return [header, ...texts].join('\n\n');
});

const intro = 'dist/index.js bundles the following third-party packages. Their license notices follow.';
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, [intro, ...sections].join(`\n\n${separator}\n\n`) + '\n');
console.log(`Wrote notices for ${packages.length} bundled packages to ${outputPath}`);
