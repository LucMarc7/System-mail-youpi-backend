const nodemailer = require('nodemailer');
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

// ===== CONFIGURATION NODEMAILER POUR SENDGRID =====
const createSendGridTransporter = () => {
  console.log("🔄 Initialisation du transporteur SendGrid...");
  
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ ERREUR CRITIQUE: SENDGRID_API_KEY non définie');
    throw new Error("SENDGRID_API_KEY manquante");
  }
  
  if (!process.env.SMTP_SENDER) {
    console.error('❌ ERREUR CRITIQUE: SMTP_SENDER non définie');
    throw new Error("SMTP_SENDER manquante");
  }
  
  console.log(`✅ Variables SendGrid détectées`);
  
  return nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
      user: "apikey",
      pass: process.env.SENDGRID_API_KEY
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
  });
};

// Créer le transporteur une seule fois
let transporterInstance = null;
const getSendGridTransporter = () => {
  if (!transporterInstance) {
    transporterInstance = createSendGridTransporter();
  }
  return transporterInstance;
};

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] 📨 ${req.method} ${req.url}`);
  
  if (req.method === 'POST' && req.body) {
    const logBody = { ...req.body };
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

// ===== ROUTES D'AUTHENTIFICATION =====

// 1. Route santé
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

// 2. Route d'inscription
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    console.log("📝 Tentative d'inscription:", { email, fullName: fullName || "Non spécifié" });
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email et mot de passe requis" });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: "Format d'email invalide" });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Le mot de passe doit contenir au moins 6 caractères" });
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
    res.status(500).json({ success: false, error: "Erreur interne du serveur" });
  }
});

// 3. Route de connexion
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log("🔐 Tentative de connexion:", { email });
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email et mot de passe requis" });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: "Format d'email invalide" });
    }
    
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
    res.status(500).json({ success: false, error: "Erreur interne du serveur" });
  }
});

// 4. Route Google Auth
app.post("/api/auth/google", (req, res) => {
  try {
    const { token, provider = "google", userInfo } = req.body;

    console.log(`🔐 Connexion via ${provider}:`, { tokenLength: token?.length || 0 });

    if (!token) {
      return res.status(400).json({ success: false, error: "Token Google requis" });
    }

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
    res.status(500).json({ success: false, error: "Erreur d'authentification Google" });
  }
});

// ===== ROUTES D'EMAIL =====

// 5. Route de template
app.get("/api/templates/preview", (req, res) => {
  try {
    const { destinator = "marketing" } = req.query;
    console.log("🎨 Génération template:", { destinator });

    const templates = {
      marketing: '<html><body style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; font-family: Arial, sans-serif; text-align: center;"><h1 style="font-size: 2.5rem; margin-bottom: 20px;">🎯 Offre Marketing Exclusive</h1><p style="font-size: 1.2rem; line-height: 1.6;">Template professionnel optimisé pour vos campagnes marketing.</p></body></html>',
      partner: '<html><body style="background: #f8f9fa; color: #333; padding: 40px; font-family: Arial, sans-serif;"><h1 style="color: #10b981; border-bottom: 2px solid #10b981; padding-bottom: 10px;">🤝 Proposition de Partenariat</h1><p style="line-height: 1.6; font-size: 1.1rem;">Template formel et élégant pour les communications professionnelles.</p></body></html>',
      ad: '<html><body style="background: #ff6b6b; color: white; padding: 40px; text-align: center; font-family: Arial, sans-serif;"><h1 style="font-size: 2.8rem; margin-bottom: 20px;">📢 PROMOTION EXCEPTIONNELLE !</h1><p style="font-size: 1.3rem; margin-bottom: 30px;">Template accrocheur et dynamique.</p></body></html>',
      other: '<html><body style="background: white; color: #333; padding: 40px; border: 1px solid #ddd; font-family: Arial, sans-serif;"><h1 style="color: #4F46E5;">✉️ Communication Professionnelle</h1><p style="line-height: 1.6;">Template simple, polyvalent et efficace.</p></body></html>',
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

// 6. Route d'envoi d'email - CORRIGÉE (timeout fix)
app.post("/api/emails/send", async (req, res) => {
  const startTime = Date.now();
  console.log("=".repeat(50));
  console.log("📧 DÉBUT - Envoi email via SendGrid");
  
  try {
    const { to, subject, message, destinator = "other", attachments = [], userEmail } = req.body;

    console.log("📋 DONNÉES REÇUES:");
    console.log("- Destinataire:", to || "NON FOURNI");
    console.log("- Sujet:", subject || "NON FOURNI");
    console.log("- Message:", message ? `${message.length} caractères` : "0 caractères");
    console.log("- Expéditeur:", userEmail || "NON FOURNI");
    console.log("- Attachments:", attachments.length);
    
    // VALIDATION RAPIDE
    const errors = [];
    if (!to) errors.push("Destinataire requis");
    if (!subject) errors.push("Sujet requis");
    if (!message) errors.push("Message requis");
    if (!userEmail) errors.push("Email expéditeur requis");
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (to && !emailRegex.test(to)) errors.push("Format email destinataire invalide");
    if (userEmail && !emailRegex.test(userEmail)) errors.push("Format email expéditeur invalide");

    if (errors.length > 0) {
      console.log("❌ Validation échouée:", errors);
      return res.status(400).json({
        success: false,
        error: errors.join(", "),
        timestamp: new Date().toISOString(),
        validationTime: `${Date.now() - startTime}ms`
      });
    }

    console.log("✅ Validation réussie");
    
    // Récupération du transporteur
    const transporter = getSendGridTransporter();
    const senderEmail = process.env.SMTP_SENDER;
    
    console.log(`📤 Préparation email: ${senderEmail} → ${to}`);
    
    // Préparation de l'email
    const mailOptions = {
      from: `"Youpi Mail" <${senderEmail}>`,
      replyTo: userEmail,
      to: to,
      subject: subject,
      text: message,
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
              <strong>Expéditeur :</strong> ${userEmail}<br>
              <em>Envoyé via Youpi Mail avec SendGrid.</em>
            </p>
          </div>
        </div>
      `
    };

    // ENVOI AVEC TIMEOUT DE 15 SECONDES MAX
    console.log("⏳ Début envoi SendGrid...");
    
    const sendWithTimeout = () => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Timeout: SendGrid n'a pas répondu après 15 secondes"));
        }, 15000);
        
        transporter.sendMail(mailOptions, (error, info) => {
          clearTimeout(timeoutId);
          if (error) {
            reject(error);
          } else {
            resolve(info);
          }
        });
      });
    };

    const info = await sendWithTimeout();
    const totalTime = Date.now() - startTime;
    
    console.log(`✅ Email accepté par SendGrid en ${totalTime}ms`);
    console.log("📨 Message ID:", info.messageId);
    console.log("=".repeat(50));
    
    // Réponse RAPIDE
    res.json({
      success: true,
      messageId: info.messageId,
      timestamp: new Date().toISOString(),
      details: `Email envoyé avec succès de "${senderEmail}" à "${to}"`,
      from: senderEmail,
      replyTo: userEmail,
      to: to,
      subject: subject,
      processingTime: `${totalTime}ms`,
      simulated: false,
      provider: "SendGrid"
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ ERREUR après ${totalTime}ms:`, error.message);
    
    let userMessage = "Échec de l'envoi de l'email";
    let statusCode = 500;
    
    if (error.message.includes("Timeout")) {
      userMessage = "SendGrid est trop lent à répondre. Veuillez réessayer.";
      statusCode = 504;
    } else if (error.code === 'EAUTH') {
      userMessage = "Erreur d'authentification SendGrid. Vérifiez votre clé API.";
    } else if (error.code === 'EENVELOPE') {
      userMessage = "Erreur dans les adresses email.";
      statusCode = 400;
    }
    
    res.status(statusCode).json({
      success: false,
      error: userMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      processingTime: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });
  }
});

// 7. Route upload
app.post("/api/upload", (req, res) => {
  try {
    const { file } = req.body;
    
    console.log("📎 Demande d'upload:", { fileName: file?.name || "Inconnu" });

    if (!file || !file.content) {
      return res.status(400).json({ success: false, error: "Fichier requis" });
    }

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
    res.status(500).json({ success: false, error: "Erreur lors de l'upload du fichier" });
  }
});

// 8. Route vérification token
app.post("/api/auth/verify", (req, res) => {
  const { token } = req.body;
  
  console.log("🔍 Vérification token:", token ? "Présent" : "Absent");
  
  if (!token) {
    return res.json({ success: false, valid: false, error: "Token manquant" });
  }
  
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

// ===== GESTION DES ERREURS =====
app.use((err, req, res, next) => {
  console.error("🔥 ERREUR GLOBALE:", err);
  
  res.status(500).json({
    success: false,
    error: "Erreur interne du serveur",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// ===== DÉMARRAGE =====
const server = app.listen(PORT, HOST, () => {
  console.log("=".repeat(60));
  console.log("🚀 YOUPI MAIL API AVEC SENDGRID - DÉMARRÉE AVEC SUCCÈS");
  console.log("=".repeat(60));
  console.log(`🌐 URL: https://system-mail-youpi-backend.onrender.com/`);
  console.log(`🔧 Port: ${PORT}`);
  console.log(`⚡ Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? '✓ Configuré' : '✗ MANQUANT'}`);
  console.log(`📧 Expéditeur: ${process.env.SMTP_SENDER || '✗ NON CONFIGURÉ'}`);
  console.log("=".repeat(60));
});

// Gestion arrêt
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM reçu: arrêt...');
  server.close(() => {
    console.log('✅ Serveur arrêté');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT reçu: arrêt...');
  server.close(() => {
    console.log('✅ Serveur arrêté');
    process.exit(0);
  });
});

module.exports = app;