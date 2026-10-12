import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const helpers = createRequire(import.meta.url);
const { workerMain } = helpers('./bounded.cjs');
const { exercise } = helpers('./toml.cjs');

workerMain(async (root, scenario) => {
  // Native ESM caller uses Node's public createRequire for the actual CJS
  // runtime chain; smol-toml's own import export is loaded as native ESM.
  const local = createRequire(path.join(root, 'package.json'));
  const vercel = createRequire(local.resolve('@vercel/node'));
  const buildUtils = createRequire(vercel.resolve('@vercel/build-utils'));
  const parent = createRequire(buildUtils.resolve('@vercel/python-analysis'));
  const tomlRoot = path.resolve(path.dirname(parent.resolve('smol-toml')), '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(tomlRoot, 'package.json'), 'utf8'));
  const esmEntry = path.join(tomlRoot, manifest.exports.import);
  const toml = await import(pathToFileURL(esmEntry).href);
  return { ...await exercise(root, scenario, toml), esmDependency: esmEntry };
});
