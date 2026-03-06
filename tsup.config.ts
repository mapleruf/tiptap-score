import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', '@tiptap/core', '@tiptap/pm', '@tiptap/react', '@tiptap/react/menus', 'vexflow'],
})
