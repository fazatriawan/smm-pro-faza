module.exports = {
  apps: [
    {
      name: 'smm-telegram-bridge',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        UNEXPECTED_POST_MONITOR_MINUTES: '0',
        PENDING_MONITOR_MINUTES: '0',
      },
    },
  ],
};
