/**
 * Minimal ambient shape for ioredis, an optional peer of this seam: the redis
 * provider imports it dynamically, so the package must typecheck and build with
 * memory-only installs. The real `Redis` class is structurally compatible with
 * the narrow `RedisLike` port the store actually uses.
 */
declare module "ioredis" {
  const Redis: new (options: Record<string, unknown>) => unknown;
  export default Redis;
}
