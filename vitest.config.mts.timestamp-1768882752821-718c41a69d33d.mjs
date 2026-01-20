// vitest.config.mts
import { dirname, join, resolve } from "node:path";
import { coverageConfigDefaults, defineConfig } from "vitest/config";
var __vite_injected_original_dirname = "/home/danny.suen@pulsar.org/Developmemt/github/lobe-chat";
var vitest_config_default = defineConfig({
  optimizeDeps: {
    exclude: ["crypto", "util", "tty"],
    include: ["@lobehub/tts"]
  },
  plugins: [
    /**
     * @lobehub/fluent-emoji@4.0.0 ships `es/FluentEmoji/style.js` but its `es/FluentEmoji/index.js`
     * imports `./style/index.js` which doesn't exist.
     *
     * In app bundlers this can be tolerated/rewritten, but Vite/Vitest resolves it strictly and
     * fails the whole test run. Redirect it to the real file.
     */
    {
      enforce: "pre",
      name: "fix-lobehub-fluent-emoji-style-import",
      resolveId(id, importer) {
        if (!importer) return null;
        const isFluentEmojiEntry = importer.endsWith("/@lobehub/fluent-emoji/es/FluentEmoji/index.js") || importer.includes("/@lobehub/fluent-emoji/es/FluentEmoji/index.js?");
        const isMissingStyleIndex = id === "./style/index.js" || id.endsWith("/@lobehub/fluent-emoji/es/FluentEmoji/style/index.js") || id.endsWith("/@lobehub/fluent-emoji/es/FluentEmoji/style/index.js?") || id.endsWith("/FluentEmoji/style/index.js") || id.endsWith("/FluentEmoji/style/index.js?");
        if (isFluentEmojiEntry && isMissingStyleIndex)
          return resolve(dirname(importer), "style.js");
        return null;
      }
    }
  ],
  test: {
    alias: {
      /* eslint-disable sort-keys-fix/sort-keys-fix */
      "@/database/_deprecated": resolve(__vite_injected_original_dirname, "./src/database/_deprecated"),
      "@/database": resolve(__vite_injected_original_dirname, "./packages/database/src"),
      "@/utils/client/switchLang": resolve(__vite_injected_original_dirname, "./src/utils/client/switchLang"),
      "@/const/locale": resolve(__vite_injected_original_dirname, "./src/const/locale"),
      // TODO: after refactor the errorResponse, we can remove it
      "@/utils/errorResponse": resolve(__vite_injected_original_dirname, "./src/utils/errorResponse"),
      "@/utils/unzipFile": resolve(__vite_injected_original_dirname, "./src/utils/unzipFile"),
      "@/utils/server": resolve(__vite_injected_original_dirname, "./src/utils/server"),
      "@/utils/identifier": resolve(__vite_injected_original_dirname, "./src/utils/identifier"),
      "@/utils/electron": resolve(__vite_injected_original_dirname, "./src/utils/electron"),
      "@/utils": resolve(__vite_injected_original_dirname, "./packages/utils/src"),
      "@/types": resolve(__vite_injected_original_dirname, "./packages/types/src"),
      "@/const": resolve(__vite_injected_original_dirname, "./packages/const/src"),
      "@": resolve(__vite_injected_original_dirname, "./src"),
      "~test-utils": resolve(__vite_injected_original_dirname, "./tests/utils.tsx"),
      "lru_map": resolve(__vite_injected_original_dirname, "./tests/mocks/lru_map")
      /* eslint-enable */
    },
    coverage: {
      all: false,
      exclude: [
        // https://github.com/lobehub/lobe-chat/pull/7265
        ...coverageConfigDefaults.exclude,
        "__mocks__/**",
        "**/packages/**",
        // just ignore the migration code
        // we will use pglite in the future
        // so the coverage of this file is not important
        "src/database/client/core/db.ts",
        "src/utils/fetch/fetchEventSource/*.ts"
      ],
      provider: "v8",
      reporter: ["text", "json", "lcov", "text-summary"],
      reportsDirectory: "./coverage/app"
    },
    environment: "happy-dom",
    exclude: [
      "**/node_modules/**",
      "**/.*/**",
      "**/dist/**",
      "**/build/**",
      "**/tmp/**",
      "**/temp/**",
      "**/docs/**",
      "**/locales/**",
      "**/public/**",
      "**/apps/desktop/**",
      "**/apps/mobile/**",
      "**/packages/**",
      "**/e2e/**"
    ],
    globals: true,
    server: {
      deps: {
        inline: [
          "vitest-canvas-mock",
          "@lobehub/ui",
          "@lobehub/fluent-emoji",
          "@pierre/diffs",
          "@pierre/diffs/react",
          "lru_map"
        ]
      }
    },
    setupFiles: join(__vite_injected_original_dirname, "./tests/setup.ts")
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy5tdHMiXSwKICAic291cmNlUm9vdCI6ICJmaWxlOi8vL2hvbWUvZGFubnkuc3VlbkBwdWxzYXIub3JnL0RldmVsb3BtZW10L2dpdGh1Yi9sb2JlLWNoYXQvIiwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9kYW5ueS5zdWVuQHB1bHNhci5vcmcvRGV2ZWxvcG1lbXQvZ2l0aHViL2xvYmUtY2hhdFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvZGFubnkuc3VlbkBwdWxzYXIub3JnL0RldmVsb3BtZW10L2dpdGh1Yi9sb2JlLWNoYXQvdml0ZXN0LmNvbmZpZy5tdHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvZGFubnkuc3VlbkBwdWxzYXIub3JnL0RldmVsb3BtZW10L2dpdGh1Yi9sb2JlLWNoYXQvdml0ZXN0LmNvbmZpZy5tdHNcIjtpbXBvcnQgeyBkaXJuYW1lLCBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdmVyYWdlQ29uZmlnRGVmYXVsdHMsIGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGVzdC9jb25maWcnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBleGNsdWRlOiBbJ2NyeXB0bycsICd1dGlsJywgJ3R0eSddLFxuICAgIGluY2x1ZGU6IFsnQGxvYmVodWIvdHRzJ10sXG4gIH0sXG4gIHBsdWdpbnM6IFtcbiAgICAvKipcbiAgICAgKiBAbG9iZWh1Yi9mbHVlbnQtZW1vamlANC4wLjAgc2hpcHMgYGVzL0ZsdWVudEVtb2ppL3N0eWxlLmpzYCBidXQgaXRzIGBlcy9GbHVlbnRFbW9qaS9pbmRleC5qc2BcbiAgICAgKiBpbXBvcnRzIGAuL3N0eWxlL2luZGV4LmpzYCB3aGljaCBkb2Vzbid0IGV4aXN0LlxuICAgICAqXG4gICAgICogSW4gYXBwIGJ1bmRsZXJzIHRoaXMgY2FuIGJlIHRvbGVyYXRlZC9yZXdyaXR0ZW4sIGJ1dCBWaXRlL1ZpdGVzdCByZXNvbHZlcyBpdCBzdHJpY3RseSBhbmRcbiAgICAgKiBmYWlscyB0aGUgd2hvbGUgdGVzdCBydW4uIFJlZGlyZWN0IGl0IHRvIHRoZSByZWFsIGZpbGUuXG4gICAgICovXG4gICAge1xuICAgICAgZW5mb3JjZTogJ3ByZScsXG4gICAgICBuYW1lOiAnZml4LWxvYmVodWItZmx1ZW50LWVtb2ppLXN0eWxlLWltcG9ydCcsXG4gICAgICByZXNvbHZlSWQoaWQsIGltcG9ydGVyKSB7XG4gICAgICAgIGlmICghaW1wb3J0ZXIpIHJldHVybiBudWxsO1xuXG4gICAgICAgIGNvbnN0IGlzRmx1ZW50RW1vamlFbnRyeSA9XG4gICAgICAgICAgaW1wb3J0ZXIuZW5kc1dpdGgoJy9AbG9iZWh1Yi9mbHVlbnQtZW1vamkvZXMvRmx1ZW50RW1vamkvaW5kZXguanMnKSB8fFxuICAgICAgICAgIGltcG9ydGVyLmluY2x1ZGVzKCcvQGxvYmVodWIvZmx1ZW50LWVtb2ppL2VzL0ZsdWVudEVtb2ppL2luZGV4LmpzPycpO1xuXG4gICAgICAgIGNvbnN0IGlzTWlzc2luZ1N0eWxlSW5kZXggPVxuICAgICAgICAgIGlkID09PSAnLi9zdHlsZS9pbmRleC5qcycgfHxcbiAgICAgICAgICBpZC5lbmRzV2l0aCgnL0Bsb2JlaHViL2ZsdWVudC1lbW9qaS9lcy9GbHVlbnRFbW9qaS9zdHlsZS9pbmRleC5qcycpIHx8XG4gICAgICAgICAgaWQuZW5kc1dpdGgoJy9AbG9iZWh1Yi9mbHVlbnQtZW1vamkvZXMvRmx1ZW50RW1vamkvc3R5bGUvaW5kZXguanM/JykgfHxcbiAgICAgICAgICBpZC5lbmRzV2l0aCgnL0ZsdWVudEVtb2ppL3N0eWxlL2luZGV4LmpzJykgfHxcbiAgICAgICAgICBpZC5lbmRzV2l0aCgnL0ZsdWVudEVtb2ppL3N0eWxlL2luZGV4LmpzPycpO1xuXG4gICAgICAgIGlmIChpc0ZsdWVudEVtb2ppRW50cnkgJiYgaXNNaXNzaW5nU3R5bGVJbmRleClcbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZShkaXJuYW1lKGltcG9ydGVyKSwgJ3N0eWxlLmpzJyk7XG5cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9LFxuICAgIH0sXG4gIF0sXG4gIHRlc3Q6IHtcbiAgICBhbGlhczoge1xuICAgICAgLyogZXNsaW50LWRpc2FibGUgc29ydC1rZXlzLWZpeC9zb3J0LWtleXMtZml4ICovXG4gICAgICAnQC9kYXRhYmFzZS9fZGVwcmVjYXRlZCc6IHJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMvZGF0YWJhc2UvX2RlcHJlY2F0ZWQnKSxcbiAgICAgICdAL2RhdGFiYXNlJzogcmVzb2x2ZShfX2Rpcm5hbWUsICcuL3BhY2thZ2VzL2RhdGFiYXNlL3NyYycpLFxuICAgICAgJ0AvdXRpbHMvY2xpZW50L3N3aXRjaExhbmcnOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL3V0aWxzL2NsaWVudC9zd2l0Y2hMYW5nJyksXG4gICAgICAnQC9jb25zdC9sb2NhbGUnOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL2NvbnN0L2xvY2FsZScpLFxuICAgICAgLy8gVE9ETzogYWZ0ZXIgcmVmYWN0b3IgdGhlIGVycm9yUmVzcG9uc2UsIHdlIGNhbiByZW1vdmUgaXRcbiAgICAgICdAL3V0aWxzL2Vycm9yUmVzcG9uc2UnOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL3V0aWxzL2Vycm9yUmVzcG9uc2UnKSxcbiAgICAgICdAL3V0aWxzL3VuemlwRmlsZSc6IHJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMvdXRpbHMvdW56aXBGaWxlJyksXG4gICAgICAnQC91dGlscy9zZXJ2ZXInOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL3V0aWxzL3NlcnZlcicpLFxuICAgICAgJ0AvdXRpbHMvaWRlbnRpZmllcic6IHJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMvdXRpbHMvaWRlbnRpZmllcicpLFxuICAgICAgJ0AvdXRpbHMvZWxlY3Ryb24nOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL3V0aWxzL2VsZWN0cm9uJyksXG4gICAgICAnQC91dGlscyc6IHJlc29sdmUoX19kaXJuYW1lLCAnLi9wYWNrYWdlcy91dGlscy9zcmMnKSxcbiAgICAgICdAL3R5cGVzJzogcmVzb2x2ZShfX2Rpcm5hbWUsICcuL3BhY2thZ2VzL3R5cGVzL3NyYycpLFxuICAgICAgJ0AvY29uc3QnOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vcGFja2FnZXMvY29uc3Qvc3JjJyksXG4gICAgICAnQCc6IHJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSxcbiAgICAgICd+dGVzdC11dGlscyc6IHJlc29sdmUoX19kaXJuYW1lLCAnLi90ZXN0cy91dGlscy50c3gnKSxcbiAgICAgICdscnVfbWFwJzogcmVzb2x2ZShfX2Rpcm5hbWUsICcuL3Rlc3RzL21vY2tzL2xydV9tYXAnKSxcbiAgICAgIC8qIGVzbGludC1lbmFibGUgKi9cbiAgICB9LFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBhbGw6IGZhbHNlLFxuICAgICAgZXhjbHVkZTogW1xuICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vbG9iZWh1Yi9sb2JlLWNoYXQvcHVsbC83MjY1XG4gICAgICAgIC4uLmNvdmVyYWdlQ29uZmlnRGVmYXVsdHMuZXhjbHVkZSxcbiAgICAgICAgJ19fbW9ja3NfXy8qKicsXG4gICAgICAgICcqKi9wYWNrYWdlcy8qKicsXG4gICAgICAgIC8vIGp1c3QgaWdub3JlIHRoZSBtaWdyYXRpb24gY29kZVxuICAgICAgICAvLyB3ZSB3aWxsIHVzZSBwZ2xpdGUgaW4gdGhlIGZ1dHVyZVxuICAgICAgICAvLyBzbyB0aGUgY292ZXJhZ2Ugb2YgdGhpcyBmaWxlIGlzIG5vdCBpbXBvcnRhbnRcbiAgICAgICAgJ3NyYy9kYXRhYmFzZS9jbGllbnQvY29yZS9kYi50cycsXG4gICAgICAgICdzcmMvdXRpbHMvZmV0Y2gvZmV0Y2hFdmVudFNvdXJjZS8qLnRzJyxcbiAgICAgIF0sXG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbJ3RleHQnLCAnanNvbicsICdsY292JywgJ3RleHQtc3VtbWFyeSddLFxuICAgICAgcmVwb3J0c0RpcmVjdG9yeTogJy4vY292ZXJhZ2UvYXBwJyxcbiAgICB9LFxuICAgIGVudmlyb25tZW50OiAnaGFwcHktZG9tJyxcbiAgICBleGNsdWRlOiBbXG4gICAgICAnKiovbm9kZV9tb2R1bGVzLyoqJyxcbiAgICAgICcqKi8uKi8qKicsXG4gICAgICAnKiovZGlzdC8qKicsXG4gICAgICAnKiovYnVpbGQvKionLFxuICAgICAgJyoqL3RtcC8qKicsXG4gICAgICAnKiovdGVtcC8qKicsXG4gICAgICAnKiovZG9jcy8qKicsXG4gICAgICAnKiovbG9jYWxlcy8qKicsXG4gICAgICAnKiovcHVibGljLyoqJyxcbiAgICAgICcqKi9hcHBzL2Rlc2t0b3AvKionLFxuICAgICAgJyoqL2FwcHMvbW9iaWxlLyoqJyxcbiAgICAgICcqKi9wYWNrYWdlcy8qKicsXG4gICAgICAnKiovZTJlLyoqJyxcbiAgICBdLFxuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgc2VydmVyOiB7XG4gICAgICBkZXBzOiB7XG4gICAgICAgIGlubGluZTogW1xuICAgICAgICAgICd2aXRlc3QtY2FudmFzLW1vY2snLFxuICAgICAgICAgICdAbG9iZWh1Yi91aScsXG4gICAgICAgICAgJ0Bsb2JlaHViL2ZsdWVudC1lbW9qaScsXG4gICAgICAgICAgJ0BwaWVycmUvZGlmZnMnLFxuICAgICAgICAgICdAcGllcnJlL2RpZmZzL3JlYWN0JyxcbiAgICAgICAgICAnbHJ1X21hcCcsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgc2V0dXBGaWxlczogam9pbihfX2Rpcm5hbWUsICcuL3Rlc3RzL3NldHVwLnRzJyksXG4g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
