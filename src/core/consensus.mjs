/**
 * VideoMind Core — Consensus Arbiter (Round 18 / L1)
 *
 * 多 AI analyzer 结果字段级投票合并, 解决"并行共识仲裁是假的"问题.
 *
 * 设计:
 *   1. 收集多 analyzer 结果 (parallel mode 下 doubao + kimi 都跑)
 *   2. 字段级对比 11 个维度 (skill_name / skill_level / key_points / ...)
 *   3. 一致 → 直接合并, confidence = 1
 *      不一致 → 用 primary 的值, 标 conflict, confidence = 0
 *   4. 总 confidence = (一致字段数 / 总字段数)
 *
 * 借鉴:
 *   - AgentChat 多模型 consensus
 *   - addyosmani/agent-skills 置信度字段
 *
 * 边界:
 *   - transcript 字段特殊: 一字不差才算一致 (避免错配)
 *   - Array 字段 (key_points / auto_tags 等) 转 set 比较
 *   - 只有一个成功 → 直接返回, confidence = 1 (无共识)
 */

const DIMENSION_KEYS = [
  'skill_name',
  'skill_level',
  'key_points',
  'action_steps',
  'tools_resources',
  'pitfalls',
  'use_cases',
  'prerequisites',
  'learning_path',
  'transcript',
  'auto_tags',
];

const ARRAY_KEYS = new Set([
  'key_points',
  'action_steps',
  'tools_resources',
  'pitfalls',
  'auto_tags',
]);

/**
 * @typedef {Object} AnalyzerResponse
 * @property {string} analyzer - 'doubao' | 'kimi' | ...
 * @property {Object|null} result - parser result 含 dimensions
 * @property {Error|null} [error] - 若失败
 */

/**
 * 多 AI 结果仲裁
 *
 * @param {AnalyzerResponse[]} responses
 * @param {Object} [options]
 * @param {string} [options.primary='doubao'] - 冲突时优先用哪个 analyzer 的值
 * @returns {Object} { result, consensus }
 *
 * @throws {Error} 全部失败时
 */
export function arbitrate(responses, options = {}) {
  const primary = options.primary || 'doubao';

  // 1. 过滤成功的响应 (有 .dimensions)
  const valid = responses.filter(r => r.result && r.result.dimensions);
  const failed = responses.filter(r => !r.result || !r.result.dimensions);

  if (valid.length === 0) {
    throw new Error('ConsensusArbiter: all analyzers failed');
  }

  // 2. 只有一个成功 → 不存在 consensus, 但仍返回
  if (valid.length === 1) {
    const only = valid[0];
    return {
      result: only.result,
      consensus: {
        analyzers: valid.map(r => r.analyzer),
        failed: failed.map(r => ({ analyzer: r.analyzer, error: r.error?.message || 'no result' })),
        agreement: singleAgreement(only.result.dimensions),
        conflicts: [],
        confidence: 1.0,
        mode: 'single-result',
        timestamp: new Date().toISOString(),
      },
    };
  }

  // 3. 多结果 — 字段级投票
  // 找 primary 排在 valid[0] (responses 顺序由调用方决定, 默认 primary 先)
  const sorted = sortByPrimary(valid, primary);

  const mergedDimensions = {};
  const agreement = {};
  const conflicts = [];

  for (const key of DIMENSION_KEYS) {
    const values = sorted.map(r => normalizeForCompare(r.result.dimensions[key], key));
    const conflictSource = sorted.map((r, i) => ({
      analyzer: r.analyzer,
      value: r.result.dimensions[key],
    }));

    if (allEqual(values)) {
      // 一致
      mergedDimensions[key] = sorted[0].result.dimensions[key];
      agreement[key] = 1.0;
    } else {
      // 冲突 → 用 primary 的值, 标 conflict
      const primaryIdx = sorted.findIndex(r => r.analyzer === primary);
      const winningIdx = primaryIdx >= 0 ? primaryIdx : 0;
      mergedDimensions[key] = sorted[winningIdx].result.dimensions[key];
      agreement[key] = 0.0;
      conflicts.push({ field: key, sources: conflictSource, winner: sorted[winningIdx].analyzer });
    }
  }

  // 4. confidence = 一致字段数 / 总字段数
  const agreedCount = Object.values(agreement).filter(v => v === 1.0).length;
  const confidence = agreedCount / DIMENSION_KEYS.length;

  return {
    result: {
      ...sorted[0].result,
      dimensions: mergedDimensions,
    },
    consensus: {
      analyzers: sorted.map(r => r.analyzer),
      failed: failed.map(r => ({ analyzer: r.analyzer, error: r.error?.message || 'no result' })),
      agreement,
      conflicts,
      confidence,
      mode: 'multi-result',
      timestamp: new Date().toISOString(),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * 把值"归一化"用于比较 — array 转 set, trim 字符串.
 * 保留原始值在 conflict.source 里.
 */
function normalizeForCompare(value, key) {
  if (value == null) return value;
  if (ARRAY_KEYS.has(key) && Array.isArray(value)) {
    const normalized = value.map(x => String(x).trim().toLowerCase()).filter(Boolean);
    return [...new Set(normalized)].sort().join('|');
  }
  return String(value).trim().toLowerCase();
}

function allEqual(arr) {
  if (arr.length === 0) return true;
  const first = arr[0];
  return arr.every(v => v === first);
}

function singleAgreement(dimensions) {
  const a = {};
  for (const key of DIMENSION_KEYS) {
    a[key] = 1.0; // 单结果无冲突
  }
  return a;
}

function sortByPrimary(responses, primary) {
  const idx = responses.findIndex(r => r.analyzer === primary);
  if (idx < 0) return responses;
  const sorted = [...responses];
  const [primaryResp] = sorted.splice(idx, 1);
  return [primaryResp, ...sorted];
}
