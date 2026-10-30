import { isJudgeDemo, assertDemoWritable } from "@/lib/judge-demo";

/** Demo reads are local fictional projections; every unlisted operation fails closed before reaching Cloud. */
export function withJudgeDemo<T extends object>(live: T, reads: Partial<Record<keyof T, (...args: any[]) => unknown>>): T {
  return new Proxy(live, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver);
      if (typeof original !== "function") return original;
      return (...args: unknown[]) => {
        if (!isJudgeDemo()) return original.apply(target, args);
        const read = reads[property as keyof T];
        if (read) return Promise.resolve(read(...args));
        return Promise.resolve().then(() => assertDemoWritable());
      };
    },
  });
}