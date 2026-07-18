import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/route-app.tsx",
      "app/page.tsx",
      "app/gestionverde-app.tsx",
      "app/gestionverde-map.tsx",
      "app/stage-one-tools.tsx",
      "app/superadmin-console.tsx",
    ],
    rules: {
      // Estos controladores restauran sesión/jornada desde sistemas externos,
      // escuchan GPS/red o reinician borradores al cambiar de vivienda.
      // Las actualizaciones reflejan localStorage, IndexedDB, D1 y APIs del navegador.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
