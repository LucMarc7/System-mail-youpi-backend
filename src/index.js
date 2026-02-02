const nodemailer = require('nodemailer');

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
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging pour toutes les requêtes
app.use((req, res, next) => {
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
});

// ===== CONFIGURATION NODEMAILER POUR SENDGRID =====
const createSendGridTransporter = () => {
  // Vérification des variables d'environnement nécessaires
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ ERREUR: SENDGRID_API_KEY non définie dans les variables d\'environnement');
  }
  if (!process.env.SMTP_SENDER) {
    console.error('❌ ERREUR: SMTP_SENDER non définie dans les variables d\'environnement');
  }
  
  return nodemailer.createTransport({
    host: 'smtp.sendgrid.net', // Serveur SMTP de SendGrid
    port: 587, // Port recommandé avec StartTLS
    secure: false, // `false` pour le port 587, `true` pour le port 465
    auth: {
      user: "apikey", // Le nom d'utilisateur est TOUJOURS 'apikey' pour SendGrid
      pass: process.env.SENDGRID_API_KEY // Votre clé API SendGrid
    },
    // Options de débogage
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
  });
};

// ===== ROUTE RACINE (CRITIQUE POUR RENDER) =====
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

// ===== ROUTES D'AUTHENTIFICATION =====

// 1. Route santé (health check)
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Youpi Mail Backend",
    uptime: process.uptime(),
    emailProvider: "SendGrid",
    memory: {
      heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`
    }
  });
});

// 2. Route d'inscription (register)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    console.log("📝 Tentative d'inscription:", { 
      email, 
      fullName: fullName || "Non spécifié",
      passwordLength: password ? password.length : 0 
    });
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Email et mot de passe requis" 
      });
    }
    
    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Format d'email invalide"
      });
    }
    
    // Validation mot de passe
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Le mot de passe doit contenir au moins 6 caractères"
      });
    }
    
    const token = `jwt_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    res.json({
      success: true,
      token,
      user: { 
        id: `user_${Date.now()}`,
        email: email.trim().toLowerCase(), 
        fullName: (fullName || email.split('@')[0]).trim(),
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Erreur inscription:", error);
    res.status(500).json({
      success: false,
      error: "Erreur interne du serveur"
    });
  }
});

// 3. Route de connexion manuelle (login)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log("🔐 Tentative de connexion:", { 
      email,
      passwordLength: password ? password.length : 0 
    });
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Email et mot de passe requis" 
      });
    }
    
    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Format d'email invalide"
      });
    }
    
    // Simulation d'authentification
    // En production, vérifier dans la base de données
    
    const token = `jwt_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    res.json({
      success: true,
      token,
      user: { 
        id: "user_123",
        email: email.trim().toLowerCase(), 
        name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
        fullName: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)
      }
    });
  } catch (error) {
    console.error("❌ Erreur connexion:", error);
    res.status(500).json({
      success: false,
      error: "Erreur interne du serveur"
    });
  }
});

// 4. Route d'authentification Google
app.post("/api/auth/google", (req, res) => {
  try {
    const { token, provider = "google", userInfo } = req.body;

    console.log(`🔐 Connexion via ${provider}:`, { 
      tokenLength: token?.length || 0,
      userInfo: userInfo ? {
        email: userInfo.email,
        name: userInfo.name,
        hasPhoto: !!userInfo.photo
      } : "Non fourni"
    });

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Token Google requis"
      });
    }

    // Simulation - En production, vérifier le token avec l'API Google
    const googleToken = `google_jwt_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    res.json({
      success: true,
      user: {
        id: userInfo?.id || `google_${Date.now()}`,
        email: userInfo?.email || "test@example.com",
        name: userInfo?.name || "Utilisateur Google",
        fullName: userInfo?.name || "Utilisateur Google",
        picture: userInfo?.photo || "https://ui-avatars.com/api/?name=" + encodeURIComponent(userInfo?.name || "User"),
      },
      smtpCredentials: {
        server: "smtp.gmail.com",
        port: 587,
        username: userInfo?.email || "test@example.com",
      },
      token: googleToken,
    });
  } catch (error) {
    console.error("❌ Erreur Google auth:", error);
    res.status(500).json({
      success: false,
      error: "Erreur d'authentification Google"
    });
  }
});

// ===== ROUTES D'EMAIL =====

// 5. Simulation de génération de template
app.get("/api/templates/preview", (req, res) => {
  try {
    const { destinator = "marketing" } = req.query;
    
    console.log("🎨 Génération template:", { destinator });

    const templates = {
      marketing:
        '<html><body style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; font-family: Arial, sans-serif; text-align: center;">' +
        '<h1 style="font-size: 2.5rem; margin-bottom: 20px;">🎯 Offre Marketing Exclusive</h1>' +
        '<p style="font-size: 1.2rem; line-height: 1.6;">Template professionnel optimisé pour vos campagnes marketing et communications commerciales.</p>' +
        '<div style="margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">' +
        '<p style="font-style: italic;">"L\'excellence au service de votre communication"</p>' +
        '</div></body></html>',
      
      partner:
        '<html><body style="background: #f8f9fa; color: #333; padding: 40px; font-family: Arial, sans-serif;">' +
        '<h1 style="color: #10b981; border-bottom: 2px solid #10b981; padding-bottom: 10px;">🤝 Proposition de Partenariat</h1>' +
        '<p style="line-height: 1.6; font-size: 1.1rem;">Template formel et élégant pour les communications professionnelles entre partenaires.</p>' +
        '<div style="margin-top: 30px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">' +
        '<p>Pour une collaboration fructueuse et durable.</p>' +
        '</div></body></html>',
      
      ad:
        '<html><body style="background: #ff6b6b; color: white; padding: 40px; text-align: center; font-family: Arial, sans-serif;">' +
        '<h1 style="font-size: 2.8rem; margin-bottom: 20px;">📢 PROMOTION EXCEPTIONNELLE !</h1>' +
        '<p style="font-size: 1.3rem; margin-bottom: 30px;">Template accrocheur et dynamique pour vos publicités et offres spéciales.</p>' +
        '<div style="background: white; color: #ff6b6b; padding: 15px 30px; border-radius: 50px; display: inline-block; font-weight: bold; font-size: 1.2rem;">' +
        'LIMITÉ À 24H !' +
        '</div></body></html>',
      
      other:
        '<html><body style="background: white; color: #333; padding: 40px; border: 1px solid #ddd; font-family: Arial, sans-serif;">' +
        '<h1 style="color: #4F46E5;">✉️ Communication Professionnelle</h1>' +
        '<p style="line-height: 1.6;">Template simple, polyvalent et efficace pour toutes vos communications.</p>' +
        '<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">' +
        '<p style="color: #666; font-size: 0.9rem;">Message professionnel et structuré</p>' +
        '</div></body></html>',
    };

    const html = templates[destinator] || templates.other;
    
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache");
    res.send(html);
  } catch (error) {
    console.error("❌ Erreur génération template:", error);
    res.status(500).send("<html><body><h1>Erreur de génération du template</h1></body></html>");
  }
});

// 6. Route d'envoi d'email RÉEL avec SendGrid - NOUVELLE VERSION
app.post("/api/emails/send", async (req, res) => {
  try {
    const { 
      to, 
      subject, 
      message, 
      destinator = "other", 
      attachments = [], 
      userEmail 
    } = req.body;

    console.log("=".repeat(50));
    console.log("📧 DEMANDE D'ENVOI RÉEL VIA SENDGRID");
    console.log("=".repeat(50));
    
    // Log détaillé de toutes les données reçues
    console.log("📋 DONNÉES REÇUES:");
    console.log("- userEmail (expéditeur pour reply-to):", userEmail || "NON FOURNI ⚠️");
    console.log("- to (destinataire):", to || "NON FOURNI");
    console.log("- subject:", subject || "NON FOURNI");
    console.log("- message length:", message ? message.length : 0, "caractères");
    console.log("- destinator:", destinator);
    console.log("- attachments:", attachments.length, "fichier(s)");
    console.log("=".repeat(50));

    // VALIDATION DES DONNÉES
    const errors = [];
    
    if (!to) errors.push("Destinataire requis");
    if (!subject) errors.push("Sujet requis");
    if (!message) errors.push("Message requis");
    if (!userEmail) errors.push("Email expéditeur requis");
    
    // Validation format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (to && !emailRegex.test(to)) errors.push("Format email destinataire invalide");
    if (userEmail && !emailRegex.test(userEmail)) errors.push("Format email expéditeur invalide");

    if (errors.length > 0) {
      console.log("❌ ERREURS DE VALIDATION:", errors);
      return res.status(400).json({
        success: false,
        error: errors.join(", "),
        details: {
          received: {
            userEmail: !!userEmail,
            to: !!to,
            subject: !!subject,
            message: !!message,
            destinator: destinator,
            attachmentsCount: attachments.length
          }
        }
      });
    }

    console.log("✅ VALIDATION RÉUSSIE");

    // Vérification des variables d'environnement SendGrid
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error("SENDGRID_API_KEY non définie dans les variables d'environnement");
    }
    if (!process.env.SMTP_SENDER) {
      throw new Error("SMTP_SENDER non définie dans les variables d'environnement");
    }

    const senderEmail = process.env.SMTP_SENDER;
    console.log(`📤 Envoi via SendGrid: ${senderEmail} → ${to} (reply-to: ${userEmail})`);

    // Configuration de l'email pour SendGrid
    const mailOptions = {
      from: `"Youpi Mail" <${senderEmail}>`, // Adresse vérifiée dans SendGrid
      replyTo: userEmail, // Les réponses iront à l'email de l'utilisateur
      to: to,
      subject: subject,
      text: message, // Version texte
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">✉️ Youpi Mail</h1>
            <p style="margin: 5px 0 0; opacity: 0.9;">Email envoyé via votre application</p>
          </div>
          <div style="padding: 30px;">
            <h2 style="color: #333; margin-top: 0;">${subject}</h2>
            <div style="color: #555; line-height: 1.6; white-space: pre-line;">${message.replace(/\n/g, '<br>')}</div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #888; font-size: 0.9em;">
              <strong>Destinataire type :</strong> ${destinator || 'Non spécifié'}<br>
              <strong>Expéditeur :</strong> ${userEmail}<br>
              <em>Cet email a été envoyé via l'API Youpi Mail avec SendGrid.</em>
            </p>
          </div>
        </div>
      `,
      // Headers personnalisés pour le tracking (optionnel)
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'YoupiMail/1.0.0'
      }
    };

    // Gestion des pièces jointes (si présentes)
    if (attachments && attachments.length > 0) {
      console.log(`📎 Préparation de ${attachments.length} pièce(s) jointe(s)`);
      mailOptions.attachments = attachments.map((att, index) => ({
        filename: att.name || `attachment-${index + 1}`,
        content: att.content,
        encoding: 'base64',
        contentType: att.type || 'application/octet-stream'
      }));
    }

    // Envoi réel avec Nodemailer/SendGrid
    const transporter = createSendGridTransporter();
    const info = await transporter.sendMail(mailOptions);

    console.log("✅ EMAIL ENVOYÉ AVEC SUCCÈS VIA SENDGRID");
    console.log("📨 Message ID:", info.messageId);
    console.log("📨 Réponse SendGrid:", info.response ? info.response.substring(0, 200) + "..." : "Pas de réponse");
    console.log("=".repeat(50));

    // Réponse au client
    res.json({
      success: true,
      messageId: info.messageId,
      timestamp: new Date().toISOString(),
      details: `Email envoyé avec succès de "${senderEmail}" à "${to}"`,
      from: senderEmail,
      replyTo: userEmail,
      to: to,
      subject: subject,
      destinator: destinator,
      attachmentsCount: attachments.length,
      sendGridInfo: {
        accepted: info.accepted,
        rejected: info.rejected,
        pending: info.pending,
        response: info.response ? info.response.substring(0, 100) : null
      },
      simulated: false,
      provider: "SendGrid"
    });

  } catch (error) {
    console.error("❌ ERREUR D'ENVOI AVEC SENDGRID:", error);
    console.error("❌ Code d'erreur:", error.code);
    console.error("❌ Stack trace:", error.stack);
    
    // Messages d'erreur plus clairs selon le type d'erreur
    let userMessage = "Échec de l'envoi de l'email via SendGrid";
    let technicalDetails = error.message;
    
    if (error.code === 'EAUTH') {
      userMessage = "Erreur d'authentification SendGrid. Vérifiez votre clé API.";
      technicalDetails = "Vérifiez que SENDGRID_API_KEY est correcte dans les variables d'environnement Render";
    } else if (error.code === 'EENVELOPE') {
      userMessage = "Erreur dans les adresses email (expéditeur ou destinataire).";
    } else if (error.message && error.message.includes('SENDGRID_API_KEY')) {
      userMessage = "Clé API SendGrid manquante. Configurez SENDGRID_API_KEY sur Render.";
    }
    
    res.status(500).json({
      success: false,
      error: userMessage,
      details: process.env.NODE_ENV === 'production' ? 'Voir les logs serveur' : technicalDetails,
      timestamp: new Date().toISOString()
    });
  }
});

// 7. Route pour upload de fichiers (simulation)
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

// ===== ROUTES UTILITAIRES =====

// Route pour vérifier un token (simulation)
app.post("/api/auth/verify", (req, res) => {
  const { token } = req.body;
  
  console.log("🔍 Vérification token:", token ? "Présent" : "Absent");
  
  if (!token) {
    return res.json({
      success: false,
      valid: false,
      error: "Token manquant"
    });
  }
  
  // Simulation: tout token qui commence par "jwt_" ou "google_jwt_" est valide
  const isValid = token.startsWith("jwt_") || token.startsWith("google_jwt_");
  
  res.json({
    success: true,
    valid: isValid,
    user: isValid ? {
      id: "user_verified",
      email: "verified@example.com",
      name: "Utilisateur Vérifié"
    } : null
  });
});

// ===== ROUTE 404 POUR LES ROUTES NON TROUVÉES =====
app.use((req, res, next) => {
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
  console.log(`📡 URL Externe: https://youpi-mail-api.onrender.com`);
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

// Export pour les tests
module.exports = app;