/**
 * Middleware de logging pour toutes les requêtes
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] 📨 ${req.method} ${req.url}`);
  
  // Log du body pour les requêtes POST (sauf les mots de passe)
  if (req.method === 'POST' && req.body) {
    const logBody = { ...req.body };
    // Masquer les mots de passe dans les logs
    if (logBody.password) logBody.password = '***';
    if (logBody.confirmPassword) logBody.confirmPassword = '***';
    console.log('📝 Body:', JSON.stringify(logBody, null, 2));
  }
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ✅ ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
};

module.exports = { requestLogger };