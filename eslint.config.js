import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import stylistic from "@stylistic/eslint-plugin";

// Export wrappers are not matched by Stylistic's "function" statement type.
const exportedFunctionSpacing = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: {
      blankLine: "Expected a blank line before function declaration.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      "ExportNamedDeclaration, ExportDefaultDeclaration"(node) {
        if (node.declaration?.type !== "FunctionDeclaration") return;
        const statements = node.parent.body;
        const previous = statements[statements.indexOf(node) - 1];
        if (!previous) return;
        const between = source.text.slice(previous.range[1], node.range[0]);
        if (/\r?\n[\t ]*\r?\n/u.test(between)) return;
        context.report({
          node,
          messageId: "blankLine",
          fix: (fixer) =>
            fixer.insertTextAfter(
              previous,
              between.includes("\n") ? "\n" : "\n\n",
            ),
        });
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "public/**",
      "internal_docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@stylistic": stylistic,
      local: {
        rules: { "exported-function-spacing": exportedFunctionSpacing },
      },
    },
    rules: {
      "local/exported-function-spacing": "error",
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "function" },
      ],
    },
  },
);
