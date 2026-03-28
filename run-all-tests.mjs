#!/usr/bin/env node

// Unified test runner — auto-discovers and runs all test files.
// Matches: **/*trace-test*.mjs and **/*-test.mjs (excluding node_modules, dist)
// Usage: node run-all-tests.mjs

import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = import.meta.dirname;
const TEST_PATTERN = /(?:trace-test|integration-test|[-\w]+-test)\.mjs$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.svelte-kit', '.tauri']);

function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (TEST_PATTERN.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const files = findTestFiles(ROOT).sort();

console.log('=== Bastion Unified Test Runner ===');
console.log(`Discovered ${files.length} test files`);
console.log();

let totalPass = 0;
let totalFail = 0;
let failedFiles = [];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  console.log(`--- Running: ${rel} ---`);

  try {
    const output = execSync(`node "${file}"`, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse results line — handles multiple formats:
    // "Results: N passed, M failed"
    // "N checks: N passed, M failed"
    // "ALL X GROUPS PASSED (N checks)"
    const match = output.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i)
      || output.match(/ALL\s+\d+\s+GROUPS?\s+PASSED\s+\((\d+)\s+checks?\)/i)
      || output.match(/(\d+)\s+passed/i);

    if (match) {
      // Handle different output formats
      let p, f;
      if (match[0].includes('PASSED')) {
        // "ALL X GROUPS PASSED (N checks)" — all passed, 0 failed
        p = parseInt(match[1], 10);
        f = 0;
      } else if (match[2] !== undefined) {
        // "N passed, M failed"
        p = parseInt(match[1], 10);
        f = parseInt(match[2], 10);
      } else {
        // "N passed" only
        p = parseInt(match[1], 10);
        f = 0;
      }
      totalPass += p;
      totalFail += f;
      const status = f > 0 ? 'FAIL' : 'PASS';
      console.log(`  ${status}: ${p} passed, ${f} failed`);
      if (f > 0) failedFiles.push(rel);
    } else {
      // Couldn't parse — show output tail
      const lines = output.trim().split('\n');
      console.log(`  (could not parse results — last line: ${lines[lines.length - 1]})`);
    }
  } catch (err) {
    // execSync throws on non-zero exit — but check if stdout has pass results
    const stdout = err.stdout?.toString() ?? '';
    const stderrOutput = err.stderr?.toString() ?? '';
    const recoveredMatch = stdout.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i)
      || stdout.match(/ALL\s+\d+\s+GROUPS?\s+PASSED\s+\((\d+)\s+checks?\)/i);

    if (recoveredMatch) {
      let p, f;
      if (recoveredMatch[0].includes('PASSED')) { p = parseInt(recoveredMatch[1], 10); f = 0; }
      else { p = parseInt(recoveredMatch[1], 10); f = parseInt(recoveredMatch[2], 10); }
      totalPass += p;
      totalFail += f;
      console.log(`  ${f > 0 ? 'FAIL' : 'PASS'}: ${p} passed, ${f} failed`);
      if (f > 0) failedFiles.push(rel);
    } else {
      totalFail++;
      failedFiles.push(rel);
      console.log(`  FAIL: ${err.message?.split('\n')[0] || 'unknown error'}`);
      if (stderrOutput) {
        const stderrLines = stderrOutput.trim().split('\n').slice(-3);
        for (const line of stderrLines) console.log(`    ${line}`);
      }
    }
  }
  console.log();
}

console.log('=================================================');
console.log(`Total: ${totalPass + totalFail} tests — ${totalPass} passed, ${totalFail} failed`);
console.log(`Files: ${files.length} discovered, ${failedFiles.length} failed`);
if (failedFiles.length > 0) {
  console.log('Failed files:');
  for (const f of failedFiles) console.log(`  - ${f}`);
}
console.log('=================================================');

if (totalFail > 0) process.exit(1);
