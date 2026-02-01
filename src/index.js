require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== ROUTES D'AUTHENTIFICATION =====

// 1. Route santé (health check)
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Youpi Mail Backend",
  });
});

// 2. Route d'inscription (register)
app.post("/api/auth/register", async (req, res) => {
  const { email, password, fullName } = req.body;
  
  // Valider les données
  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: "Email et mot de passe requis" 
    });
  }
  
  // Ici: Hasher le mot de passe, créer l'utilisateur dans la base de données
  // Pour l'instant, simulation:
  console.log("📝 Nouvel utilisateur:", { email, fullName: fullName || "Non spécifié" });
  
  // Générer un token JWT (simplifié)
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
  
  // Valider les données
  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: "Email et mot de passe requis" 
    });
  }
  
  // Ici: Vérifier l'email/mot de passe dans la base de données
  // Pour l'instant, simulation:
  console.log("🔐 Connexion manuelle de:", email);
  
  // Générer un token JWT (simplifié)
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

// ===== ROUTES D'EMAIL =====

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

// 6. Route d'envoi d'email AVEC VALIDATION
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

// 7. Route pour upload de fichiers (simulation)
app.post("/api/upload", (req, res) => {
  console.log("📎 Upload simulé");
  res.json({
    success: true,
    url: "https://example.com/uploads/simulated-file.pdf",
    filename: "test-file.pdf",
    size: 1024 * 1024,
  });
});

// ===== EXPORT ET DÉMARRAGE =====

// IMPORTANT: Exporter l'app pour les tests
module.exports = app;

// Démarrer le serveur SEULEMENT si exécuté directement
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Serveur backend en cours d'exécution sur http://localhost:${PORT}`);
    console.log(`📋 Routes disponibles:`);
    console.log(`   GET    http://localhost:${PORT}/api/health`);
    console.log(`   POST   http://localhost:${PORT}/api/auth/register`);
    console.log(`   POST   http://localhost:${PORT}/api/auth/login`);
    console.log(`   POST   http://localhost:${PORT}/api/auth/google`);
    console.log(`   GET    http://localhost:${PORT}/api/templates/preview?destinator=marketing`);
    console.log(`   POST   http://localhost:${PORT}/api/emails/send`);
    console.log(`   POST   http://localhost:${PORT}/api/upload`);
    console.log(`\n🔧 Mode: ${process.env.NODE_ENV || 'development'}`);
  });
}