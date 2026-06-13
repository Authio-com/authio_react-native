import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    hooks: "src/hooks.ts",
    provider: "src/provider.tsx",
    types: "src/types.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: "dist",
  external: [
    "react",
    "react-native",
    "react-native-passkey",
    "@react-native-async-storage/async-storage",
  ],
  target: "es2020",
});
