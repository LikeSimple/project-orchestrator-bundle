#!/usr/bin/env node
/**
 * Performance Benchmark Runner
 *
 * 运行全量基准测试并输出结果到 docs/benchmarks/baseline.json
 *
 * 用法：
 *   node run-benchmark.js                    # 运行全量基准测试
 *   node run-benchmark.js --compare <file>   # 与已有基线对比
 */

const path = require('path');
const fs = require('fs').promises;
const bench = require('./lib/benchmark');

async function main() {
  const args = process.argv.slice(2);
  const compareMode = args.includes('--compare');
  const compareFile = args[args.indexOf('--compare') + 1];

  const baseDir = path.resolve(__dirname);
  const outputDir = path.resolve(baseDir, '..', 'docs', 'benchmarks');
  const outputFile = path.join(outputDir, 'baseline.json');

  console.log('🚀 Starting performance benchmarks...\n');

  // 运行基准测试
  const result = await bench.runAll({ cwd: baseDir, iterations: 10 });

  // 打印摘要
  console.log('═══════════════════════════════════════════════════');
  console.log('  Performance Benchmark Results');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Node: ${result.metadata.nodeVersion}`);
  console.log(`  Platform: ${result.metadata.platform}`);
  console.log(`  CPU: ${result.metadata.cpuModel} (${result.metadata.cpuCores} cores)`);
  console.log(`  Memory: ${result.metadata.totalMemGB} GB`);
  console.log(`  Total time: ${result.metadata.totalTimeMs} ms`);
  console.log('');

  // 模块加载
  console.log('── Module Load Time ──────────────────────────────────');
  for (const [name, data] of Object.entries(result.moduleLoad)) {
    console.log(`  ${name.padEnd(22)} ${data.avg.toFixed(2).padStart(10)} ms  (min: ${data.min.toFixed(2)} ms)`);
  }
  console.log('');

  // AST 解析
  console.log('── AST Parsing ──────────────────────────────────────');
  for (const [name, data] of Object.entries(result.astBenchmark)) {
    console.log(`  ${name.padEnd(22)} ${data.avg.toFixed(3).padStart(10)} ms  (min: ${data.min.toFixed(3)} ms, n=${data.samples})`);
  }
  console.log('');

  // LLM 客户端
  console.log('── LLM Client ───────────────────────────────────────');
  console.log(`  Available: ${result.llmBenchmark.available}`);
  console.log(`  Provider: ${result.llmBenchmark.provider || 'none'}`);
  console.log(`  isAvailable() avg: ${result.llmBenchmark.isAvailable.avg.toFixed(4)} ms`);
  console.log(`  getProviderName() avg: ${result.llmBenchmark.getProviderName.avg.toFixed(4)} ms`);
  console.log('');

  // Skill 操作
  console.log('── Skill Operations ─────────────────────────────────');
  for (const [name, data] of Object.entries(result.skillOperations)) {
    console.log(`  ${name.padEnd(28)} ${data.avg.toFixed(3).padStart(10)} ms  (n=${data.samples})`);
  }
  console.log('');

  // 内存
  console.log('── Memory ────────────────────────────────────────────');
  console.log(`  Before: heap ${result.memory.before.heapUsedMB} MB / rss ${result.memory.before.rssMB} MB`);
  console.log(`  After:  heap ${result.memory.after.heapUsedMB} MB / rss ${result.memory.after.rssMB} MB`);
  console.log(`  Delta:  heap +${result.memory.delta.heapUsedMB} MB / rss +${result.memory.delta.rssMB} MB`);
  console.log(`  Skills loaded: ${result.memory.loadedSkills}`);
  console.log('');

  // 对比模式
  if (compareMode && compareFile) {
    try {
      const oldBaseline = JSON.parse(await fs.readFile(compareFile, 'utf-8'));
      console.log('── Comparison with Previous Baseline ───────────────');
      console.log(`  Comparing with: ${compareFile}`);
      console.log(`  Previous date: ${oldBaseline.metadata?.completedAt || 'unknown'}\n`);

      for (const [name, newData] of Object.entries(result.astBenchmark)) {
        const oldData = oldBaseline.astBenchmark?.[name];
        if (oldData) {
          const diff = newData.avg - oldData.avg;
          const pct = ((diff / oldData.avg) * 100).toFixed(1);
          const sign = diff > 0 ? '⚠️  +' : '✅ ';
          console.log(`  ${name.padEnd(22)} ${oldData.avg.toFixed(3)} → ${newData.avg.toFixed(3)} ms  ${sign}${pct}%`);
        }
      }
      console.log('');
    } catch (e) {
      console.log(`  ⚠️ Could not compare: ${e.message}\n`);
    }
  }

  // 保存结果
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✅ Baseline saved to: ${path.relative(baseDir, outputFile)}`);
}

main().catch(err => {
  console.error('❌ Benchmark failed:', err.message);
  process.exit(1);
});
