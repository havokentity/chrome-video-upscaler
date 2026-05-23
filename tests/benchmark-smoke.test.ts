import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/collect-benchmark.mjs');

describe('benchmark smoke CLI', () => {
  test('prints usage help', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help'], {
      cwd: repoRoot,
    });

    expect(stdout).toContain('node scripts/collect-benchmark.mjs');
    expect(stdout).toContain('--mode auto,crisp');
    expect(stdout).toContain('--screenshot-dir <dir>');
    expect(stdout).toContain('neural-lite,neural-pro');
  });

  test('skips cleanly when the built extension is unavailable', async () => {
    const missingExtension = path.join(tmpdir(), `missing-extension-${Date.now().toString()}`);
    const { stdout } = await execFileAsync(
      'node',
      [scriptPath, '--extension', missingExtension, '--mode', 'crisp', '--duration-ms', '250'],
      { cwd: repoRoot },
    );
    const result = JSON.parse(stdout) as {
      reason: string;
      runs: unknown[];
      skipped: boolean;
    };

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('Built extension not found');
    expect(result.runs).toEqual([]);
  });

  test('accepts every documented smoke mode and records screenshot options', async () => {
    const missingExtension = path.join(tmpdir(), `missing-extension-${Date.now().toString()}`);
    const screenshotDir = path.join(tmpdir(), `benchmark-screenshots-${Date.now().toString()}`);
    const modes = [
      'none',
      'auto',
      'crisp',
      'sharpen',
      'anime',
      'smooth',
      'edge',
      'night-vision',
      'predator',
      'crt',
      'invert',
      'cartoon',
      'neural-lite',
      'neural-pro',
    ].join(',');

    const { stdout } = await execFileAsync(
      'node',
      [
        scriptPath,
        '--extension',
        missingExtension,
        '--mode',
        modes,
        '--duration-ms',
        '250',
        '--screenshot-dir',
        screenshotDir,
      ],
      { cwd: repoRoot },
    );
    const result = JSON.parse(stdout) as {
      options: {
        modes: string[];
        screenshotDir: string;
      };
      skipped: boolean;
    };

    expect(result.skipped).toBe(true);
    expect(result.options.modes).toContain('neural-lite');
    expect(result.options.modes).toContain('neural-pro');
    expect(result.options.screenshotDir).toBe(screenshotDir);
  });

  test('can write markdown with manual benchmark placeholders', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'benchmark-smoke-'));
    const outputPath = path.join(tempDir, 'benchmark.md');

    try {
      await execFileAsync(
        'node',
        [
          scriptPath,
          '--extension',
          path.join(tempDir, 'missing-extension'),
          '--mode',
          'crisp',
          '--duration-ms',
          '250',
          '--output',
          'markdown',
          '--output-path',
          outputPath,
        ],
        { cwd: repoRoot },
      );

      const markdown = await readFile(outputPath, 'utf8');
      expect(markdown).toContain('# Benchmark Smoke Results');
      expect(markdown).toContain('Manual Apple Silicon Benchmark Rows');
      expect(markdown).toContain('Apple Silicon chip used for manual run');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
