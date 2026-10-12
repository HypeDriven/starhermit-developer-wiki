import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const file of readdirSync('tests').filter(file => file.endsWith('.test.mjs')).sort()) {
  const result = spawnSync(process.execPath, [`tests/${file}`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync('python3', ['scripts/check-docs.py'], { stdio: 'inherit' });
process.exit(result.status || 0);
