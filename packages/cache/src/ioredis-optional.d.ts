declare module "ioredis" {
  const Redis: new (options: Record<string, unknown>) => unknown;
  export default Redis;
}
