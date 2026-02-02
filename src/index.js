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

// 4. Route d'authentification Google
app.post("/api/auth/google", (req, res) => {
  const { token, provider = "google", userInfo } = req.body;

  console.log(`🔐 Connexion via ${provider}:`, token?.substring(0, 20) + "...");

  // Simulation - À remplacer par vérification réelle du token Google
  res.json({
    success: true,
    user: {
      id: userInfo?.id || `google_${Date.now()}`,
      email: userInfo?.email || "test@example.com",
      name: userInfo?.name || "Test User",
      picture: userInfo?.photo || "https://example.com/avatar.jpg",
    },
    smtpCredentials: {
      server: "smtp.gmail.com",
      port: 587,
      username: userInfo?.email || "test@example.com",
    },
    token: `google_jwt_${Date.now()}`, // Token pour le frontend
  });
});

// ===== ROUTES D'EMAIL - AJOUTÉES =====

// 5. Simulation de génération de template
app.get("/api/templates/preview", (req, res) => {
  const { destinator } = req.query;

  const templates = {
    marketing:
      '<html><body style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px;"><h1>🎯 Offre Marketing</h1><p>Template professionnel pour vos campagnes marketing.</p></body></html>',
    partner:
      '<html><body style="background: #f8f9fa; color: #333; padding: 40px; font-family: Arial;"><h1>🤝 Collaboration Partenaire</h1><p>Template formel pour communications entre partenaires.</p></body></html>',
    ad: '<html><body style="background: #ff6b6b; color: white; padding: 40px; text-align: center;"><h1>📢 Promotion Spéciale !</h1><p>Template accrocheur pour publicités.</p></body></html>',
    other:
      '<html><body style="background: white; color: #333; padding: 40px; border: 1px solid #ddd;"><h1>✉️ Email Standard</h1><p>Template simple et polyvalent.</p></body></html>',
  };

  const html = templates[destinator] || templates.other;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// 6. Route d'envoi d'email AVEC VALIDATION - AJOUTÉE
app.post("/api/emails/send", (req, res) => {
  const { to, subject, message, destinator, attachments = [], userEmail } = req.body;

  // VALIDATION DES DONNÉES
  if (!to || !subject || !message) {
    return res.status(400).json({
      success: false,
      error: "Les champs 'to', 'subject' et 'message' sont obligatoires."
    });
  }

  console.log("📧 Email à envoyer (simulation):");
  console.log("- De:", userEmail || "infos@ceoawardsdrc.com (par défaut)");
  console.log("- À:", to);
  console.log("- Sujet:", subject);
  console.log("- Destinataire type:", destinator || "non spécifié");
  console.log("- Pièces jointes:", attachments.length);

  // Simuler un délai d'envoi
  setTimeout(() => {
    res.json({
      success: true,
      messageId: `simulated_${Date.now()}`,
      timestamp: new Date().toISOString(),
      details: `Email simulé de ${userEmail || "infos@ceoawardsdrc.com"} vers ${to} avec succès`,
      from: userEmail || "infos@ceoawardsdrc.com", // Retourne l'email utilisé comme FROM
    });
  }, 1000);
});

// 7. Route pour upload de fichiers (simulation) - AJOUTÉE
app.post("/api/upload", (req, res) => {
  console.log("📎 Upload simulé");
  res.json({
    success: true,
    url: "https://example.com/uploads/simulated-file.pdf",
    filename: "test-file.pdf",
    size: 1024 * 1024,
  });
});

// ===== ROUTE 404 POUR LES ROUTES NON TROUVÉES =====
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée: ${req.method} ${req.path}`,
    availableRoutes: [
      "GET /",
      "GET /api/health",
      "POST /api/auth/register",
      "POST /api/auth/login", 
      "POST /api/auth/google",
      "GET /api/templates/preview",
      "POST /api/emails/send",
      "POST /api/upload"
    ]
  });
});

// ===== DÉMARRAGE DU SERVEUR =====
app.listen(PORT, HOST, () => {
  console.log(`✅ Serveur démarré avec succès`);
  console.log(`🌐 URL: http://${HOST}:${PORT}`);
  console.log(`📡 Accès externe: https://youpi-mail-api.onrender.com`);
  console.log(`🔧 Port: ${PORT}`);
  console.log(`⚡ Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Mémoire: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
  
  // Afficher toutes les routes disponibles
  console.log(`\n📋 Routes disponibles:`);
  console.log(`   GET    /`);
  console.log(`   GET    /api/health`);
  console.log(`   POST   /api/auth/register`);
  console.log(`   POST   /api/auth/login`);
  console.log(`   POST   /api/auth/google`);
  console.log(`   GET    /api/templates/preview?destinator=marketing`);
  console.log(`   POST   /api/emails/send`);
  console.log(`   POST   /api/upload`);
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