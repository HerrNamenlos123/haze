module.exports = {
    env: {
        browser: true,
        es2021: true,
        node: true,
    },
    parser: "@typescript-eslint/parser",
    parserOptions: {
        parser: "@typescript-eslint/parser",
        // ecmaVersion: 2021,
        // sourceType: "module",
        projectService: true,
        tsconfigRootDir: __dirname,
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended-type-checked"
    ],
    rules: {
        "require-await": ["error"],
        // "@typescript-eslint/no-floating-promises": ["error"]
    },
};
