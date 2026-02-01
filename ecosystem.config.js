module.exports = {
  apps: [{
    name: 'youpi-mail-api',
    script: './src/index.js',
    instances: 'max',          // Utilise tous les CPUs
    exec_mode: 'cluster',      // Mode cluster pour performance
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',  // Redémarre si > 1GB mémoire
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 8080
    }
  }],

  deploy: {
    production: {
      user: 'ubuntu',
      host: ['votre-serveur.com'],
      ref: 'origin/main',
      repo: 'git@github.com:votre-compte/youpi-mail.git',
      path: '/var/www/youpi-mail',
      'post-deploy': 'cd backend && npm install && pm2 reload ecosystem.config.js --env production',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};