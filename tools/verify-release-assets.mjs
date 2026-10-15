import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const forbiddenNames = /warehouse-image-guided|island-portal-exterior|warehouse-interior/i;
const forbiddenCode = /ai-warehouse-experiment|Candidate entry · walk through the north doorway/;
async function inspect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (forbiddenNames.test(entry.name)) throw Error(`Restricted experiment asset in release: ${file}`);
    if (entry.isDirectory()) await inspect(file);
    else if (/\.(?:js|html|css)$/.test(entry.name) && forbiddenCode.test(await readFile(file, 'utf8')))
      throw Error(`Experimental warehouse runtime in release: ${file}`);
  }
}
await inspect(process.argv[2] ?? 'dist');
console.log('Release asset boundary: restricted warehouse experiment excluded.');
