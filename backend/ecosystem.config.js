/**
 * PM2 Ecosystem Configuration — Artesa Producción
 * Los logs se escriben en backend/logs/ junto con los logs de Winston.
 */
module.exports = {
  apps: [
    {
      name: 'artesa-backend-prod',
      script: './src/server.js',
      cwd: '/home/ubuntu/LaArtesa/backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '400M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      error_file: '/home/ubuntu/LaArtesa/backend/logs/pm2-error.log',
      out_file: '/home/ubuntu/LaArtesa/backend/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'artesa-backend-staging',
      script: './src/server.js',
      cwd: '/home/ubuntu/LaArtesa/backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '400M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      error_file: '/home/ubuntu/LaArtesa/backend/logs/pm2-error.log',
      out_file: '/home/ubuntu/LaArtesa/backend/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'staging',
        PORT: 3000,
      },
    },
  ],
};
