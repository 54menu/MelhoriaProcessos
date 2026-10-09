import { readFile, writeFile } from "node:fs/promises";

const assets = [
  ["contracts/taxonomy.v1.json", "supabase/functions/_shared/taxonomy.generated.mjs", "taxonomy"],
  ["contracts/approved-examples.v1.json", "supabase/functions/_shared/examples.generated.mjs", "exampleCatalog"],
];
for (const [source, target, name] of assets) {
  const value = JSON.parse(await readFile(new URL(`../${source}`, import.meta.url), "utf8"));
  const expected = `// Generated from ${source}; run npm run assets:classification.\nexport const ${name} = ${JSON.stringify(value, null, 2)};\n`;
  if (process.argv.includes("--check")) {
    const actual = await readFile(new URL(`../${target}`, import.meta.url), "utf8");
    if (actual.replace(/\r\n/g, "\n") !== expected) throw new Error(`Asset desatualizado: ${target}`);
  } else await writeFile(new URL(`../${target}`, import.meta.url), expected, "utf8");
}
