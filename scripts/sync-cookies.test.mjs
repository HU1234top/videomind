/**
 * scripts/sync-cookies.test.mjs — sync-cookies.mjs 单元测试
 *
 * 因为 sync-cookies.mjs 整个文件是 mjs script（不在 src/ 下），我们用
 * 重新实现相同的过滤/分组逻辑来 test，但避免反复启动 playwright。
 *
 * 测的是可独立测试的纯函数：cookie 过滤 + 域名分组
 */

// 复刻 sync-cookies 的纯逻辑，让测试可以独立运行
const TARGET_DOMAINS = [
  'doubao.com', '.doubao.com',
  'kimi.com', '.kimi.com',
  'douyin.com', '.douyin.com',
  'bilibili.com', '.bilibili.com'
];

function filterByDomain(cookies, domains) {
  return cookies.filter(c =>
    domains.some(d => c.domain.endsWith(d) || c.domain === d)
  );
}

function groupByDomain(cookies) {
  const out = {};
  for (const c of cookies) {
    out[c.domain] = (out[c.domain] || 0) + 1;
  }
  return out;
}

function dedupeAddList(filtered, existingMap) {
  const toAdd = [];
  let skipped = 0;
  for (const c of filtered) {
    const key = `${c.domain}|${c.name}`;
    const existing = existingMap.get(key);
    if (existing && existing.value === c.value) {
      skipped++;
      continue;
    }
    toAdd.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expires || -1,
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite: c.sameSite || 'Lax'
    });
  }
  return { toAdd, skipped };
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('filterByDomain', () => {
  test('includes www.doubao.com', () => {
    const got = filterByDomain(
      [{ domain: '.doubao.com', name: 'sessionid', value: 'a' }],
      TARGET_DOMAINS
    );
    assert.equal(got.length, 1);
  });

  test('includes doubao.com without leading dot', () => {
    const got = filterByDomain(
      [{ domain: 'doubao.com', name: 'x', value: 'y' }],
      TARGET_DOMAINS
    );
    assert.equal(got.length, 1);
  });

  test('excludes unrelated domain (github.com)', () => {
    const got = filterByDomain(
      [{ domain: '.github.com', name: 'x', value: 'y' }],
      TARGET_DOMAINS
    );
    assert.equal(got.length, 0);
  });

  test('includes bilibili subdomains (api.bilibili.com)', () => {
    const got = filterByDomain(
      [{ domain: '.api.bilibili.com', name: 'x', value: 'y' }],
      TARGET_DOMAINS
    );
    assert.equal(got.length, 1);
  });

  test('handles empty list', () => {
    assert.equal(filterByDomain([], TARGET_DOMAINS).length, 0);
  });
});

describe('groupByDomain', () => {
  test('counts correctly', () => {
    const got = groupByDomain([
      { domain: '.doubao.com', name: 'a' },
      { domain: '.doubao.com', name: 'b' },
      { domain: '.bilibili.com', name: 'c' }
    ]);
    assert.equal(got['.doubao.com'], 2);
    assert.equal(got['.bilibili.com'], 1);
  });
});

describe('dedupeAddList', () => {
  test('skips identical values', () => {
    const filtered = [
      { domain: '.doubao.com', name: 'sessionid', value: 'abc', expires: 1000, httpOnly: true, secure: true, sameSite: 'Lax' }
    ];
    const existing = new Map([['.doubao.com|sessionid', { value: 'abc' }]]);
    const { toAdd, skipped } = dedupeAddList(filtered, existing);
    assert.equal(skipped, 1);
    assert.equal(toAdd.length, 0);
  });

  test('adds when value differs', () => {
    const filtered = [
      { domain: '.doubao.com', name: 'sessionid', value: 'new', expires: 1000, httpOnly: true, secure: true, sameSite: 'Lax' }
    ];
    const existing = new Map([['.doubao.com|sessionid', { value: 'old' }]]);
    const { toAdd, skipped } = dedupeAddList(filtered, existing);
    assert.equal(skipped, 0);
    assert.equal(toAdd.length, 1);
    assert.equal(toAdd[0].value, 'new');
  });

  test('adds when not in existing', () => {
    const filtered = [
      { domain: '.kimi.com', name: 'newcookie', value: 'x', expires: 1000, httpOnly: false, secure: false, sameSite: 'Lax' }
    ];
    const existing = new Map();
    const { toAdd, skipped } = dedupeAddList(filtered, existing);
    assert.equal(skipped, 0);
    assert.equal(toAdd.length, 1);
  });

  test('preserves httpOnly/secure flags', () => {
    const filtered = [
      { domain: '.doubao.com', name: 'sessionid', value: 'x', path: '/api', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }
    ];
    const { toAdd } = dedupeAddList(filtered, new Map());
    assert.equal(toAdd[0].httpOnly, true);
    assert.equal(toAdd[0].secure, true);
    assert.equal(toAdd[0].path, '/api');
  });
});

describe('integration: full filter → group → dedupe flow', () => {
  test('simulates daily cookie sync to debug profile', () => {
    const dailyCookies = [
      // 目标域（要同步）
      { domain: '.doubao.com', name: 'sessionid', value: 'real_session_123', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' },
      { domain: '.kimi.com', name: 'auth_token', value: 'kimi_abc', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' },
      { domain: '.bilibili.com', name: 'SESSDATA', value: 'bili_xyz', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' },
      { domain: '.bilibili.com', name: 'bili_jct', value: 'jct_123', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax', path: '/' },
      // 非目标（跳过）
      { domain: '.github.com', name: 'user_session', value: 'gh_aaa', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' },
      { domain: '.google.com', name: 'NID', value: 'goog_xxx', expires: 9999, httpOnly: false, secure: true, sameSite: 'Lax', path: '/' }
    ];

    const filtered = filterByDomain(dailyCookies, TARGET_DOMAINS);
    assert.equal(filtered.length, 4, '应过滤出 4 个目标 cookie');

    const grouped = groupByDomain(filtered);
    assert.equal(grouped['.doubao.com'], 1);
    assert.equal(grouped['.kimi.com'], 1);
    assert.equal(grouped['.bilibili.com'], 2);

    // 假设 debug 已经有 1 个 doubao cookie（值不同）
    const existing = new Map([
      ['.doubao.com|sessionid', { value: 'old_session' }]
    ]);
    const { toAdd, skipped } = dedupeAddList(filtered, existing);
    // 值不同 → 不 skip，加入 toAdd 替换
    assert.equal(skipped, 0, '值不同 → 不 skip');
    assert.equal(toAdd.length, 4, '4 个都要注入（包括更新已存在的）');
  });
});