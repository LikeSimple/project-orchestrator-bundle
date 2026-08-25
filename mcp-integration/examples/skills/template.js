/**
 * Skill 实现模板（参考骨架）
 *
 * 每个 Skill 的实现遵循此模板。
 * 拷贝此文件 → skills/<skill-name>/index.js → 修改 commands。
 *
 * 核心约定：
 * 1. 使用 CommonJS（与 skill-cli.js 保持一致）
 * 2. 每个 command 导出为函数，接收 input 对象，返回 SkillResult
 * 3. input 始终包含 projectRoot（已由 skill-cli 注入）
 * 4. 错误返回 { ok: false, error, warnings }，不要 throw
 * 5. 日志用 console.error（写 stderr，不影响 stdout JSON）
 * 6. 文件操作使用绝对路径（基于 projectRoot）
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================================
// 导出所有 commands
// ============================================================

module.exports = {
  // 示例 command：实现 Skill 的某个功能
  async exampleCommand({ param1, param2, projectRoot }) {
    // 1. 参数校验
    if (!param1) {
      return {
        ok: false,
        error: 'param1 is required',
      };
    }

    try {
      // 2. 执行业务逻辑（文件操作 / 子进程 / 网络请求等）
      // ...

      // 3. 返回成功结果
      return {
        ok: true,
        data: {
          summary: `✅ Did something useful`,
          // 其他结构化数据
        },
        warnings: [],
        nextActions: ['What user should do next'],
      };
    } catch (err) {
      // 4. 捕获异常（不要 throw）
      return {
        ok: false,
        error: err.message?.slice(0, 300) || 'Unknown error',
        warnings: ['server-side', 'or other hints'],
      };
    }
  },
};
