/**
 * 账号名称展示：优先使用游戏内角色名 (roleName)，缺失时回退到用户设置的 token.name
 * 仅用于展示层，不改变数据存储。
 */
export function accountName(token) {
  if (!token) return "";
  return token.roleName || token.name || "";
}
