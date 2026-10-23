const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'docs/RIDDLE_BANK_53_TAGGED_V1.json'), 'utf8'));
const document = fs.readFileSync(path.join(root, 'docs/RIDDLE_BANK_53_TAGGED_V1.md'), 'utf8');
const answers = ['安全带', '斧头', '米老鼠', '火锅', '书包', '彩虹', '闪电', '雾', '霜', '露珠',
  '河流', '大海', '云', '猫', '狗', '蝴蝶', '蜜蜂', '蚂蚁', '萤火虫', '兔子', '面条', '咖啡',
  '茶', '饺子', '自行车', '电梯', '飞机', '火车', '台灯', '橡皮', '烟花', '耳机', '路由器',
  '充电宝', '指纹', '脚印', '侦探', '密码', '放大镜', '世界杯', '羽毛球', '围棋', '扑克牌',
  '沙漏', '时间', '海市蜃楼', '影子', '化石', '算盘', '毛笔', '长城', '兵马俑', '胶片'];

test('tagged bank preserves all 53 supplied answers in source order with unique stable IDs', () => {
  assert.equal(bank.status, 'integrated_local');
  assert.deepEqual(bank.riddles.map(row => row.answer), answers);
  assert.equal(new Set(bank.riddles.map(row => row.id)).size, answers.length);
  for (const [index, row] of bank.riddles.entries()) {
    assert.equal(row.id, `R${String(index + 1).padStart(3, '0')}`);
    assert.ok(row.hint.trim());
  }
  assert.equal(bank.riddles[21].hint, '早起犯困时靠它提神，夜里有人因它睡不着');
  assert.equal(bank.riddles[29].hint, '专门负责"后悔"，让错误消失不见');
  assert.equal(bank.riddles[50].hint, '它在山脊上蜿蜒万里，当年曾是一道守护边防的屏障');
});

test('five approved revisions replace outdated hints and are no longer pending suggestions', () => {
  for (const [id, answer, hint] of [
    ['R007', '闪电', '它一闪而过，常把黑暗撕出一道口子'],
    ['R017', '蜜蜂', '它常在花朵间忙，你不招惹它，它一般也不来招惹你'],
    ['R022', '咖啡', '早起犯困时靠它提神，夜里有人因它睡不着'],
    ['R032', '耳机', '它很轻巧，靠它可以把各种声音送到耳边'],
    ['R051', '长城', '它在山脊上蜿蜒万里，当年曾是一道守护边防的屏障'],
  ]) {
    const row = bank.riddles.find(row => row.id === id);
    assert.equal(row.answer, answer);
    assert.equal(row.hint, hint);
    assert.equal(Object.hasOwn(row, 'suggested_hint'), false);
  }
  assert.deepEqual(bank.riddles.filter(row => row.suggested_hint).map(row => row.answer), ['影子']);
});

test('every riddle has valid difficulty, category, soft-match tags and review data', () => {
  for (const row of bank.riddles) {
    assert.ok(Object.hasOwn(bank.difficulty_labels, row.difficulty), row.id);
    assert.ok(row.category && row.difficulty_reason, row.id);
    assert.ok(row.content_tags.length && row.audience_tags.length && row.recommended_scenarios.length, row.id);
    for (const field of ['content_tags', 'environment_tags', 'audience_tags', 'recommended_scenarios']) {
      assert.ok(Array.isArray(row[field]), `${row.id}.${field}`);
      assert.equal(new Set(row[field]).size, row[field].length, `${row.id}.${field}`);
    }
    assert.ok(row.environment_tags.every(tag => bank.environment_options.includes(tag)), row.id);
    assert.ok(row.audience_tags.every(tag => bank.audience_options.includes(tag)), row.id);
    assert.ok(row.recommended_scenarios.every(tag => Object.hasOwn(bank.scenario_labels, tag)), row.id);
    assert.ok(Array.isArray(row.review_notes), row.id);
    if (row.suggested_hint) assert.ok(row.review_notes.length && row.suggested_hint !== row.hint, row.id);
  }
});

test('editable table matches JSON hints, tags, difficulty and summary counts', () => {
  const counts = {};
  for (const row of bank.riddles) {
    counts[row.difficulty] = (counts[row.difficulty] || 0) + 1;
    const tableRow = `| ${row.id} | ${row.answer} | ${row.hint} | ${bank.difficulty_labels[row.difficulty]} | ${row.content_tags.join('、')} | ${row.environment_tags.join('、') || '通用'} | ${row.audience_tags.join('、')} | ${row.recommended_scenarios.map(id => id.slice(-1)).join('、')} |`;
    assert.ok(document.includes(tableRow), row.id);
    if (row.suggested_hint) assert.ok(document.includes(row.suggested_hint), row.id);
  }
  for (const [difficulty, count] of Object.entries(counts)) {
    assert.ok(document.includes(`| ${bank.difficulty_labels[difficulty]} | ${count} |`));
  }
  assert.ok(document.includes(`| 总题数 | ${answers.length} |`));
});
