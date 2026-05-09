#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MAX_FUNCTIONS = 12;
const API_DIR = path.resolve(__dirname, '..', 'api');
const FUNCTION_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(fullPath);
    }

    return entry.isFile() ? [fullPath] : [];
  });
}

function isDeployableFunction(filePath) {
  const relativeParts = path.relative(API_DIR, filePath).split(path.sep);
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath);

  if (!FUNCTION_EXTENSIONS.has(extension) || fileName.endsWith('.d.ts')) {
    return false;
  }

  return !relativeParts.some((part) => part.startsWith('_') || part.startsWith('.'));
}

const functions = walk(API_DIR)
  .filter(isDeployableFunction)
  .map((filePath) => path.relative(process.cwd(), filePath))
  .sort();

console.log(`Vercel deployable functions: ${functions.length}/${MAX_FUNCTIONS}`);
functions.forEach((functionPath) => console.log(`- ${functionPath}`));

if (functions.length > MAX_FUNCTIONS) {
  console.error(
    `Error: ${functions.length} deployable functions found. Hobby limit is ${MAX_FUNCTIONS}.`
  );
  process.exit(1);
}
