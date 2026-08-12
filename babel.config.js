module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        allowlist: null,
        blocklist: null,
        allowUndefined: true,
        verbose: false,
      },
    ],
  ],
};
