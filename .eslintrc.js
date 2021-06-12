module.exports = {
  env: {
    es2021: true,
  },
  extends: ["airbnb-base", "prettier", "plugin:import/typescript"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "prettier"],
  rules: {
    "prettier/prettier": ["error"],
    "@typescript-eslint/no-unused-vars": "error",

    // Remove the JS no-useless-constructor rules and replace it with TS ones
    "no-useless-constructor": "off",
    "@typescript-eslint/no-useless-constructor": ["error"],
    "no-empty-function": "off",
    "@typescript-eslint/no-empty-function": ["error"],

    // Laying out source-code for ease of reading can be impeded by this rule
    "no-use-before-define": 0,

    // banning iterators/generators is just weird
    "no-restricted-syntax": 0,

    "import/extensions": [
      "error",
      "ignorePackages",
      {
        js: "never",
        ts: "never",
      },
    ],
  },
};
