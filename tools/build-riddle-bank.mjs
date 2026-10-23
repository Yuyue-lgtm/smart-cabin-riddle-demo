import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'docs', name), 'utf8'));
const general = read('RIDDLE_BANK_53_TAGGED_V1.json').riddles.map(row => ({ ...row, pool: 'general' }));
const special = read('ENVIRONMENT_RIDDLE_BANK_V2.json').riddles.map(row => ({
  ...row, pool: 'environment', environment_tags: [row.environment], recommended_scenarios: [],
}));
const byId = new Map([...general, ...special].map(row => [row.id, row]));
// Keep the first eight existing indices stable; persistent history uses IDs, not positions.
const first = ['RAIN-01', 'R001', 'R002', 'R003', 'R004', 'SNOW-01', 'CITY_DAY-01', 'R005'];
const ordered = [...first.map(id => byId.get(id)), ...[...general, ...special].filter(row => !first.includes(row.id))];
const legacyThemes = { '雨天': '雨天', '雪景': '雪景', '城市白天': '城区', '城市夜晚': '城区', '风景区': '风景', '傍晚': '风景', '深夜': '风景' };
const data = ordered.map(row => ({
  id: row.id, answer: row.answer, hint: row.hint,
  theme: row.pool === 'environment' ? legacyThemes[row.environment] : row.category,
  pool: row.pool, difficulty: row.difficulty, category: row.category,
  environmentTags: row.environment_tags, audienceTags: row.audience_tags,
  contentTags: row.content_tags, scenarioTags: row.recommended_scenarios,
}));
if (data.length !== 91 || new Set(data.map(row => row.id)).size !== data.length
  || new Set(data.map(row => row.answer)).size !== data.length) throw new Error('Riddle bank must contain 91 unique IDs and answers');
const version = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
const block = `// BEGIN GENERATED RIDDLE BANK: node tools/build-riddle-bank.mjs\nconst RIDDLE_BANK_VERSION = "${version}";\nconst RIDDLES = ${JSON.stringify(data, null, 2)};\n// END GENERATED RIDDLE BANK`;
const target = path.join(root, 'client-app.js');
const source = fs.readFileSync(target, 'utf8');
const pattern = source.includes('// BEGIN GENERATED RIDDLE BANK:')
  ? /\/\/ BEGIN GENERATED RIDDLE BANK:[\s\S]*?\/\/ END GENERATED RIDDLE BANK/
  : /const RIDDLES = \[[\s\S]*?\n\];/;
if (!pattern.test(source)) throw new Error('Missing generated bank boundary');
const output = source.replace(pattern, () => block);
if (process.argv.includes('--check')) {
  if (output !== source) throw new Error('Runtime bank is stale; run node tools/build-riddle-bank.mjs');
} else fs.writeFileSync(target, output);
console.log(JSON.stringify({ bank_version: version, total: data.length, general: general.length, environment: special.length }));
