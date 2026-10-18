import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

for (const filename of ['openapi.yaml', 'DATA-API.yaml', 'compose.yaml']) {
  const document = parseDocument(await readFile(filename, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${filename}: ${document.errors.map((error) => error.message).join('\n')}`);
  const value = document.toJS();
  if (filename === 'openapi.yaml') {
    const inspect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
        let target = value;
        for (const segment of node.$ref.slice(2).split('/')) target = target?.[segment];
        if (!target) throw new Error(`Unresolved OpenAPI reference: ${node.$ref}`);
      }
      Object.values(node).forEach(inspect);
    };
    inspect(value);
  }
  console.log(`${filename}: OK`);
}
