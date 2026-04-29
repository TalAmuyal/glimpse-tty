import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import { resolveUrl } from './args';

describe('resolveUrl', () => {
  test('absolute path is converted to file:// URL', () => {
    expect(resolveUrl('/tmp/file.html')).toBe('file:///tmp/file.html');
  });

  test('absolute path with spaces is properly encoded', () => {
    expect(resolveUrl('/path/my file.html')).toBe(pathToFileURL('/path/my file.html').href);
  });

  test('relative path starting with ./ is resolved to absolute file:// URL', () => {
    const result = resolveUrl('./file.html');
    const expected = pathToFileURL(resolve(process.cwd(), './file.html')).href;
    expect(result).toBe(expected);
  });

  test('relative path starting with ../ is resolved to absolute file:// URL', () => {
    const result = resolveUrl('../file.html');
    const expected = pathToFileURL(resolve(process.cwd(), '../file.html')).href;
    expect(result).toBe(expected);
  });

  test('home-relative path ~/... is resolved to absolute file:// URL', () => {
    const result = resolveUrl('~/file.html');
    const expected = pathToFileURL(resolve(homedir(), 'file.html')).href;
    expect(result).toBe(expected);
  });

  test('https:// URL passes through unchanged', () => {
    expect(resolveUrl('https://example.com')).toBe('https://example.com');
  });

  test('http:// URL passes through unchanged', () => {
    expect(resolveUrl('http://example.com')).toBe('http://example.com');
  });

  test('file:// URL passes through unchanged', () => {
    expect(resolveUrl('file:///already/correct')).toBe('file:///already/correct');
  });

  test('data: URL passes through unchanged', () => {
    expect(resolveUrl('data:text/html,<h1>hi</h1>')).toBe('data:text/html,<h1>hi</h1>');
  });

  test('domain-like arg gets https:// prefix', () => {
    expect(resolveUrl('example.com')).toBe('https://example.com');
  });

  test('domain with path gets https:// prefix', () => {
    expect(resolveUrl('example.com/page')).toBe('https://example.com/page');
  });

  test('domain starting with "http" gets https:// prefix', () => {
    expect(resolveUrl('httpbin.org')).toBe('https://httpbin.org');
  });

  test('domain starting with "data" gets https:// prefix', () => {
    expect(resolveUrl('data.gov')).toBe('https://data.gov');
  });

  test('domain starting with "file" gets https:// prefix', () => {
    expect(resolveUrl('filesystem.example.com')).toBe('https://filesystem.example.com');
  });
});
