/**
 * spec 文档在项目内的相对路径。
 *
 * `@` 前缀便于直接粘进 agent 对话引用文件——两端复制出的字符串必须一致，
 * 所以这个函数放在 gui-shared，而不是各写一份。
 *
 * 目录写死 `.yorz/specs`：项目可以用 `specsDir` 改这个位置，但列表接口不返回
 * 真实路径，前端手上只有 specId。与桌面端既有行为保持一致，不在这里另作猜测。
 */
export function specFilePath(specId: string): string {
  return `@.yorz/specs/${specId}/spec.md`
}
