'use strict';
// Preserve the actual installed builder output. This is packaging evidence,
// not a deployable release or a statement about the remote runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_FILES = 40000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

function relativeName(name) {
  assert(typeof name === 'string' && name.length > 0 && name.length < 1024);
  assert(!path.isAbsolute(name) && !name.includes('\\'));
  assert(name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe output path');
  return name;
}
function json(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function sourceIdentity(root, sourceNames) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const actualSources = walk(path.join(root, 'api'), 'api').filter(name => name.endsWith('.ts')).sort();
  const trackedSources = git('ls-files', '-z', '--', 'api').split('\0').filter(name => name.endsWith('.ts')).sort();
  assert.deepEqual(actualSources, trackedSources, 'Untracked or missing API TypeScript input');
  assert.deepEqual([...sourceNames].sort(), actualSources, 'Complete current API TypeScript source required');
  const names = [...sourceNames, '.npmrc', 'vercel.json', 'package.json', 'package-lock.json', 'scripts/verify-api-packaging.cjs', 'scripts/api-packaging-evidence.cjs'].sort();
  const trackedNames = new Set(git('ls-files', '-z').split('\0'));
  assert(names.every(name => trackedNames.has(name)), 'Every packaging source/control input must be tracked');
  return {
    head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
    // CI creates separate test-harness checkouts. They are recorded below and
    // cannot become API inputs; tracked source hygiene remains an exact binding.
    trackedClean: git('status', '--porcelain=v1', '--untracked-files=no') === '',
    files: names.map(name => ({ path: relativeName(name), sha256: sha(fs.readFileSync(path.join(root, name))) })),
    builder: { version: require('@vercel/node/package.json').version,
      packageSha256: sha(fs.readFileSync(require.resolve('@vercel/node/package.json'))) },
  };
}
function begin(destination, root, sourceNames) {
  const folder = path.resolve(destination);
  assert(path.isAbsolute(destination) && !fs.existsSync(folder), 'New absolute evidence directory required');
  fs.mkdirSync(folder, { mode: 0o700 });
  const fullStatus = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  return { folder, source: sourceIdentity(root, sourceNames), workingTree: {
    fullyClean: fullStatus === '', untrackedEntryCount: fullStatus.split('\n').filter(line => line.startsWith('?? ')).length,
  }, functions: [], totalBytes: 0, totalFiles: 0 };
}
async function preserve(state, entrypoint, output) {
  assert(output && typeof output === 'object' && typeof output.handler === 'string' && typeof output.runtime === 'string');
  const index = state.functions.length;
  const directory = `functions/${String(index + 1).padStart(2, '0')}`;
  const files = [];
  for (const name of Object.keys(output.files).sort()) {
    relativeName(name);
    const ref = output.files[name];
    assert(ref && typeof ref.toStream === 'function', 'Builder file must expose its actual bytes');
    const stream = await ref.toStream();
    assert(stream && typeof stream.on === 'function' && typeof stream.once === 'function' && typeof stream.destroy === 'function');
    const chunks = [];
    let size = 0;
    // The installed builder also returns legacy readable-stream objects whose
    // public data/end/error contract predates Symbol.asyncIterator.
    await new Promise((resolve, reject) => {
      let settled = false;
      const finishRead = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        finishRead(new Error('Builder file stream timed out'));
        stream.destroy();
      }, 10000);
      stream.on('data', chunk => {
        try {
          assert(typeof chunk === 'string' || chunk instanceof Uint8Array, 'Unknown builder byte type');
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          assert(size <= MAX_FILE_BYTES, 'Builder file exceeds bounded evidence size');
          chunks.push(bytes);
        } catch (error) { finishRead(error); stream.destroy(); }
      });
      stream.once('end', () => finishRead());
      stream.on('error', finishRead);
      stream.once('close', () => { if (!settled) finishRead(new Error('Builder file stream closed before end')); });
    });
    const bytes = Buffer.concat(chunks);
    state.totalBytes += size;
    state.totalFiles += 1;
    assert(state.totalFiles <= MAX_FILES && state.totalBytes <= MAX_TOTAL_BYTES, 'Packaging evidence exceeds bounds');
    const relative = `${directory}/${name}`;
    const target = path.join(state.folder, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    files.push({ path: relative, builderPath: name, size, sha256: sha(bytes) });
  }
  assert(files.some(file => file.builderPath === output.handler), 'Emitted handler missing');
  state.functions.push({ entrypoint, handler: output.handler, runtime: output.runtime,
    architecture: output.architecture ?? null, files });
}
function finish(state) {
  assert.equal(state.functions.length, 12, 'All twelve actual API functions required');
  const value = { schema: 1, type: 'ADMIN_API_PACKAGING_EVIDENCE', builderMode: 'isDev', source: state.source,
    workingTree: state.workingTree,
    buildHost: { platform: process.platform, architecture: process.arch, node: process.version },
    ci: { repository: process.env.GITHUB_REPOSITORY ?? null, head: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      event: process.env.GITHUB_EVENT_NAME ?? null },
    functions: state.functions, totalBytes: state.totalBytes, totalFiles: state.totalFiles,
    deploymentPerformed: false, remoteRuntime: 'NOT_VERIFIED', deployableRelease: false,
    boundary: 'Actual builder output from API TypeScript inputs; hashes do not prove remote acceptance or absence of arbitrarily encoded secrets.' };
  json(path.join(state.folder, 'manifest.json'), value);
  return { manifestSha256: sha(fs.readFileSync(path.join(state.folder, 'manifest.json'))),
    functions: value.functions.length, files: value.totalFiles, bytes: value.totalBytes };
}
function walk(folder, prefix = '') {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(item => {
    assert(!item.isSymbolicLink(), 'Packaging evidence symlink forbidden');
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) return walk(path.join(folder, item.name), name);
    assert(item.isFile(), 'Packaging evidence special file forbidden');
    return [name];
  });
}
function verify(folder, root) {
  folder = path.resolve(folder); root = path.resolve(root);
  const actualNames = walk(folder);
  assert(actualNames.length <= MAX_FILES + 1 && actualNames.includes('manifest.json'));
  const bytes = fs.readFileSync(path.join(folder, 'manifest.json'));
  const value = JSON.parse(bytes);
  assert.equal(value.schema, 1); assert.equal(value.type, 'ADMIN_API_PACKAGING_EVIDENCE');
  assert.equal(value.builderMode, 'isDev');
  assert.equal(value.deploymentPerformed, false); assert.equal(value.deployableRelease, false);
  assert.equal(value.remoteRuntime, 'NOT_VERIFIED');
  assert(Array.isArray(value.functions) && value.functions.length === 12);
  assert(Array.isArray(value.source?.files));
  const sources = value.source.files.filter(file => file.path.startsWith('api/') && file.path.endsWith('.ts')).map(file => file.path);
  const current = sourceIdentity(root, sources);
  assert.deepEqual(value.source, current, 'Packaging source or installed builder changed');
  const expected = new Set(['manifest.json']);
  let count = 0; let total = 0;
  const entrypoints = new Set();
  const expectedEntries = sources.filter(name => !name.split('/').some(part => part.startsWith('_') || part.startsWith('.')) && !name.endsWith('.d.ts'));
  for (const func of value.functions) {
    relativeName(func.entrypoint); relativeName(func.handler);
    assert(!entrypoints.has(func.entrypoint), 'Duplicate API function'); entrypoints.add(func.entrypoint);
    // Preserve the installed builder's development-packaging label verbatim.
    // The actual Node version is recorded separately, never inferred as remote.
    assert(func.runtime === 'nodejs', 'Unexpected development-packaging runtime');
    assert(func.architecture === null || func.architecture === 'x86_64' || func.architecture === 'arm64');
    assert(Array.isArray(func.files) && func.files.some(file => file.builderPath === func.handler));
    for (const file of func.files) {
      relativeName(file.path); relativeName(file.builderPath);
      assert(!expected.has(file.path), 'Duplicate emitted file'); expected.add(file.path);
      assert(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= MAX_FILE_BYTES);
      const target = path.join(folder, file.path);
      assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
      const data = fs.readFileSync(target);
      assert.equal(data.length, file.size); assert.equal(sha(data), file.sha256);
      count += 1; total += data.length;
      assert(count <= MAX_FILES && total <= MAX_TOTAL_BYTES);
    }
  }
  assert.deepEqual(entrypoints, new Set(expectedEntries), 'Actual API entrypoints differ');
  assert.deepEqual(new Set(actualNames), expected, 'Incomplete or additional emitted file set');
  assert.equal(count, value.totalFiles); assert.equal(total, value.totalBytes);
  return { status: 'PACKAGING_BYTES_VERIFIED', manifestSha256: sha(bytes), source: current,
    buildHost: value.buildHost, ci: value.ci, workingTree: value.workingTree,
    functions: entrypoints.size, files: count, bytes: total,
    deploymentPerformed: false, remoteRuntime: 'NOT_VERIFIED', deployableRelease: false };
}
module.exports = { begin, preserve, finish, verify };
if (require.main === module) {
  assert.equal(process.argv.length, 4, 'Expected evidence directory and trusted source root');
  try { console.log(JSON.stringify(verify(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
