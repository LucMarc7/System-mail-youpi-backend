require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
// IMPORTANT: Sur Render, utiliser '0.0.0.0' comme host
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== ROUTE RACINE (CRITIQUE POUR RENDER) =====
app.get("/", (req, res) => {
  res.json({
    message: "🚀 Youpi Mail API",
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "GET /api/health",
      register: "POST /api/auth/register",
      login: "POST /api/auth/login",
      googleAuth: "POST /api/auth/google",
      sendEmail: "POST /api/emails/send",
      upload: "POST /api/upload",
      templates: "GET /api/templates/preview?destinator=marketing"
    },
    environment: process.env.NODE_ENV || 'development'
  });
});

// ===== ROUTES D'AUTHENTIFICATION =====

// 1. Route santé (health check)
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Youpi Mail Backend",
    uptime: process.uptime()
  });
});

// 2. Route d'inscription (register)
app.post("/api/auth/register", async (req, res) => {
  const { email, password, fullName } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: "Email et mot de passe requis" 
    });
  }
  
  console.log("📝 Nouvel utilisateur:", { email, fullName: fullName || "Non spécifié" });
  
  const token = `jwt_simulated_${Date.now()}`;
  
  res.json({
    success: true,
    token,
    user: { 
      id: `user_${Date.now()}`,
      email, 
      fullName: fullName || email.split('@')[0]
    }
  });
});

// 3. Route de connexion manuelle (login)
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: "Email et mot de passe requis" 
    });
  }
  
  console.log("🔐 Connexion manuelle de:", email);
  
  const token = `jwt_simulated_${Date.now()}`;
  
  res.json({
    success: true,
    token,
    user: { 
      id: "user_123",
      email, 
      name: "Utilisateur Test" 
    }
  });
});

// ... [copiez le reste de vos routes ici] ...

// ===== DÉMARRAGE DU SERVEUR =====
// SUPPRIMEZ la condition if (require.main === module)

app.listen(PORT, HOST, () => {
  console.log(`✅ Serveur démarré avec succès`);
  console.log(`🌐 URL: http://${HOST}:${PORT}`);
  console.log(`📡 Accès externe: https://youpi-mail-api.onrender.com`);
  console.log(`🔧 Port: ${PORT}`);
  console.log(`⚡ Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Mémoire: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
  console.error('⚠️ Erreur non capturée:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Rejet non géré:', reason);
});

// Export pour les tests
module.exports = app;