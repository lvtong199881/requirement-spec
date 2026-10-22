// Conventional Commits 1.0.0 —— 与 CONTRIBUTING.md 保持一致
// 用法：npm i -D @commitlint/cli @commitlint/config-conventional
//       echo "msg" | npx commitlint
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'subject-case': [0],       // 中文没有大小写，关掉
    'header-max-length': [2, 'always', 100],
  },
};
