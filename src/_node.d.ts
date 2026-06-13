// Minimal ambient declaration for CommonJS `require` so we can probe
// for optional peer deps at runtime without pulling in @types/node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any;

declare const Buffer: {
  from(input: string, encoding?: string): { toString(encoding: string): string };
};

