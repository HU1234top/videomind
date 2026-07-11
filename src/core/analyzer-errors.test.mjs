/**
 * src/core/analyzer-errors.test.mjs — 错误类单测
 *
 * 验证每个错误类的：
 *   1. 必要字段（code/analyzer/evidence/attempts）
 *   2. instanceof Error
 *   3. 消息可读性（包含关键信息）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalyzerUnavailableError,
  NotLoggedInError,
  AnalyzerUnreachableError
} from './analyzer-errors.mjs';

describe('AnalyzerUnavailableError', () => {
  test('has code = UNAVAILABLE and analyzer name', () => {
    const err = new AnalyzerUnavailableError('kimi', 'not yet implemented');
    assert.equal(err.code, 'UNAVAILABLE');
    assert.equal(err.analyzer, 'kimi');
    assert.equal(err.name, 'AnalyzerUnavailableError');
    assert.ok(err.message.includes('kimi'));
    assert.ok(err.message.includes('not yet implemented'));
  });

  test('is instanceof Error', () => {
    const err = new AnalyzerUnavailableError('kimi', 'test');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AnalyzerUnavailableError);
  });
});

describe('NotLoggedInError', () => {
  test('has code = NOT_LOGGED_IN and evidence', () => {
    const err = new NotLoggedInError('doubao', 'login button visible at selector .login');
    assert.equal(err.code, 'NOT_LOGGED_IN');
    assert.equal(err.analyzer, 'doubao');
    assert.equal(err.evidence, 'login button visible at selector .login');
    assert.ok(err.message.includes('doubao'));
    assert.ok(err.message.includes('login button'));
  });

  test('is instanceof Error', () => {
    const err = new NotLoggedInError('doubao', 'test');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof NotLoggedInError);
  });
});

describe('AnalyzerUnreachableError', () => {
  test('has code = UNREACHABLE and attempts array', () => {
    const attempts = [
      { name: 'doubao', error: { code: 'NOT_LOGGED_IN', message: 'login' } },
      { name: 'kimi', error: { code: 'UNAVAILABLE', message: 'not implemented' } },
      { name: 'gemini', error: { code: 'UNAVAILABLE', message: 'not implemented' } }
    ];
    const err = new AnalyzerUnreachableError('https://test/video/1', attempts);
    assert.equal(err.code, 'UNREACHABLE');
    assert.equal(err.videoUrl, 'https://test/video/1');
    assert.equal(err.attempts.length, 3);
    assert.ok(err.message.includes('doubao=NOT_LOGGED_IN'));
    assert.ok(err.message.includes('kimi=UNAVAILABLE'));
  });

  test('handles empty attempts gracefully', () => {
    const err = new AnalyzerUnreachableError('url', []);
    assert.equal(err.attempts.length, 0);
    assert.ok(err.message.includes('0 attempts'));
  });

  test('handles missing error in attempt gracefully', () => {
    const err = new AnalyzerUnreachableError('url', [{ name: 'broken' }]);
    assert.ok(err.message.includes('broken=UNKNOWN'));
  });

  test('is instanceof Error', () => {
    const err = new AnalyzerUnreachableError('url', []);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AnalyzerUnreachableError);
  });
});

describe('error classification matrix', () => {
  test('all errors have unique code values', () => {
    const codes = [
      new AnalyzerUnavailableError('x', 'y').code,
      new NotLoggedInError('x', 'y').code,
      new AnalyzerUnreachableError('x', []).code
    ];
    const unique = new Set(codes);
    assert.equal(unique.size, codes.length, 'all codes must be unique');
  });
});