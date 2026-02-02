require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Middlewares
const { requestLogger } = require("./middleware/logger");

// Routes
const authRoutes = require("./routes/auth.routes");
const emailRoutes = require("./routes/email.routes");
const templateRoutes = require("./routes/template.routes");

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

// Configuration CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use(requestLogger);

// ===== ROUTE RACINE =====
app.get("/", (req, res) => {
  res.json({
    message: "🚀 Youpi Mail API avec SendGrid",
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    emailProvider: "SendGrid",
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

// ===== MONTER LES ROUTES =====
app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/templates", templateRoutes);

// Route pour upload de fichiers (simulation)
app.post("/api/upload", (req, res) => {
  try {
    const { file } = req.body;
    
    console.log("📎 Demande d'upload:", {
      fileName: file?.name || "Inconnu",
      fileType: file?.type || "Inconnu",
      contentLength: file?.content?.length || 0
    });

    if (!file || !file.content) {
      return res.status(400).json({
        success: false,
        error: "Fichier requis"
      });
    }

    // Simulation d'upload réussi
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    res.json({
      success: true,
      url: `https://storage.youpimail.com/uploads/${fileId}/${encodeURIComponent(file.name || "file")}`,
      filename: file.name || "uploaded_file",
      size: file.content.length,
      id: fileId,
      uploadedAt: new Date().toISOString(),
      type: file.type || "application/octet-stream"
    });
  } catch (error) {
    console.error("❌ Erreur upload:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de l'upload du fichier"
    });
  }
});

// ===== ROUTE 404 =====
app.use((req, res) => {
  console.log(`❌ Route non trouvée: ${req.method} ${req.url}`);
  
  res.status(404).json({
    success: false,
    error: `Route non trouvée: ${req.method} ${req.path}`,
    availableRoutes: [
      "GET    /",
      "GET    /api/health",
      "POST   /api/auth/register",
      "POST   /api/auth/login", 
      "POST   /api/auth/google",
      "POST   /api/auth/verify",
      "GET    /api/templates/preview?destinator=[marketing|partner|ad|other]",
      "POST   /api/emails/send",
      "POST   /api/upload"
    ],
    timestamp: new Date().toISOString()
  });
});

// ===== GESTION DES ERREURS GLOBALES =====
app.use((err, req, res, next) => {
  console.error("🔥 ERREUR GLOBALE:", err);
  
  res.status(500).json({
    success: false,
    error: "Erreur interne du serveur",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// ===== DÉMARRAGE DU SERVEUR =====
const server = app.listen(PORT, HOST, () => {
  console.log("=".repeat(60));
  console.log("🚀 YOUPI MAIL API AVEC SENDGRID - DÉMARRÉE AVEC SUCCÈS");
  console.log("=".repeat(60));
  console.log(`🌐 URL Interne: http://${HOST}:${PORT}`);
  console.log(`📡 URL Externe: https://system-mail-youpi-backend.onrender.com/`);
  console.log(`🔧 Port: ${PORT}`);
  console.log(`⚡ Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Mémoire: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB utilisés`);
  console.log(`📧 Provider: SendGrid (${process.env.SENDGRID_API_KEY ? 'API Key configurée' : 'API Key MANQUANTE'})`);
  console.log(`📧 Expéditeur: ${process.env.SMTP_SENDER || 'NON CONFIGURÉ'}`);
  console.log("=".repeat(60));
  console.log("📋 ROUTES DISPONIBLES:");
  console.log("   GET    /                              - Info API");
  console.log("   GET    /api/health                    - Health check");
  console.log("   POST   /api/auth/register             - Inscription");
  console.log("   POST   /api/auth/login                - Connexion");
  console.log("   POST   /api/auth/google               - Connexion Google");
  console.log("   POST   /api/auth/verify               - Vérification token");
  console.log("   GET    /api/templates/preview         - Prévisualisation template");
  console.log("   POST   /api/emails/send               - Envoi d'email RÉEL (SendGrid)");
  console.log("   POST   /api/upload                    - Upload de fichier");
  console.log("=".repeat(60));
  console.log(`⏰ Démarrage: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM reçu: arrêt du serveur HTTP...');
  server.close(() => {
    console.log('✅ Serveur HTTP arrêté');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT reçu: arrêt du serveur HTTP...');
  server.close(() => {
    console.log('✅ Serveur HTTP arrêté');
    process.exit(0);
  });
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
  console.error('⚠️ ERREUR NON CAPTURÉE:', err);
  console.error('Stack trace:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ REJET NON GÉRÉ:', reason);
  console.error('Promise:', promise);
});

module.exports = app;