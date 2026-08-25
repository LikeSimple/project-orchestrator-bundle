/**
 * 构建后脚本：将 skill-cli.cjs 复制到 dist/
 *
 * skill-cli.cjs 直接引用 examples/skills/ 和 examples/lib/ 目录，
 * 无需复制 skills/ 和 lib/ 到 dist/（避免 Windows 文件系统损坏问题）
 */
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const distDir = join(root, 'dist');

console.log('[postbuild] Copying assets to dist/...');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// 复制 skill-cli.cjs（唯一需要复制的文件）
const skillCliSrc = join(root, 'src', 'skill-cli.cjs');
const skillCliDest = join(distDir, 'skill-cli.cjs');
copyFileSync(skillCliSrc, skillCliDest);
console.log(`  ✓ skill-cli.cjs (references examples/ directly)`);

console.log('[postbuild] Done.');
