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
        "prefer-const": "off",
        "no-fallthrough": "off", // Typescript already checks this and ESlint is too stupid for assert(false)
        "no-empty": "off",
        "@typescript-eslint/no-floating-promises": ["error"],
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/restrict-plus-operands": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-namespace": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
        "@typescript-eslint/no-unnecessary-type-assertion": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unused-vars": [
            "warn",
            {
                "args": "all",
                "argsIgnorePattern": "^_",
                "caughtErrors": "all",
                "caughtErrorsIgnorePattern": "^_",
                "destructuredArrayIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
                "ignoreRestSiblings": true
            }
        ]
    },
};
