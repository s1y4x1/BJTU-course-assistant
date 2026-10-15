import { readFile } from 'node:fs/promises';

// Check the actual external imports without starting the server or opening a port.
const server = await readFile(new URL('./server.js', import.meta.url), 'utf8');
const imports = [...server.matchAll(/^import\s+.+?\s+from\s+['"]([^'"]+)['"];\s*$/gm)]
  .map((match) => match[1])
  .filter((specifier) => !specifier.startsWith('node:') && !specifier.startsWith('.'));

try {
  await Promise.all(imports.map((specifier) => import(specifier)));
} catch (error) {
  console.error(`Bridge dependency check failed: ${error.message}`);
  process.exitCode = 1;
}
