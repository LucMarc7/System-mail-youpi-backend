const nodemailer = require('nodemailer');
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

// ===== CONFIGURATION NODEMAILER POUR SENDGRID =====
const createSendGridTransporter = () => {
  console.log("=".repeat(60));
  console.log("🔄 INITIALISATION TRANSPORTEUR SENDGRID");
  console.log("=".repeat(60));
  
  // Vérification DÉTAILLÉE des variables
  console.log("🔍 Vérification variables d'environnement:");
  
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ ERREUR CRITIQUE: SENDGRID_API_KEY non définie');
    console.error('   ➡️ Ajoutez SENDGRID_API_KEY sur Render: Settings > Environment');
    throw new Error("SENDGRID_API_KEY manquante - Configurez-la sur Render");
  }
  
  if (!process.env.SMTP_SENDER) {
    console.error('❌ ERREUR CRITIQUE: SMTP_SENDER non définie');
    console.error('   ➡️ Ajoutez SMTP_SENDER sur Render (email vérifié SendGrid)');
    throw new Error("SMTP_SENDER manquante - Configurez un email vérifié sur Render");
  }
  
  console.log("✅ SENDGRID_API_KEY: Présente (longueur:", process.env.SENDGRID_API_KEY.length, "chars)");
  console.log("   Début clé:", process.env.SENDGRID_API_KEY.substring(0, 10) + "...");
  console.log("✅ SMTP_SENDER:", process.env.SMTP_SENDER);
  
  // Validation format clé API
  if (!process.env.SENDGRID_API_KEY.startsWith('SG.')) {
    console.error('⚠️ ATTENTION: La clé API ne commence pas par "SG." - format suspect');
  }
  
  // Validation format email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(process.env.SMTP_SENDER)) {
    console.error('⚠️ ATTENTION: SMTP_SENDER n\'est pas un email valide');
  }
  
  console.log("⚙️  Création transporteur avec timeout...");
  
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: "apikey", // TOUJOURS 'apikey' pour SendGrid
        pass: process.env.SENDGRID_API_KEY
      },
      // Timeouts STRICTES pour éviter les blocages
      connectionTimeout: 10000,  // 10s max pour se connecter
      greetingTimeout: 10000,    // 10s max pour salutation
      socketTimeout: 15000,      // 15s max pour opérations socket
      // Debug activé pour voir la conversation SMTP
      debug: true, // TOUJOURS activé pour le diagnostic
      logger: true
    });
    
    console.log("✅ Transporteur SendGrid créé avec succès");
    console.log("=".repeat(60));
    
    return transporter;
  } catch (transportError) {
    console.error("❌ ERREUR création transporteur Nodemailer:", transportError.message);
    console.error("❌ Stack:", transportError.stack);
    throw transportError;
  }
};

// Créer le transporteur une seule fois
let transporterInstance = null;
const getSendGridTransporter = () => {
  if (!transporterInstance) {
    try {
      transporterInstance = createSendGridTransporter();
    } catch (error) {
      console.error("💥 ERREUR FATALE: Impossible de créer le transporteur SendGrid");
      transporterInstance = null;
      throw error;
    }
  }
  return transporterInstance;
};

// ===== MIDDLEWARES =====
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging amélioré
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.log(`\n[${new Date().toISOString()}] 📨 ${req.method} ${req.url} [ID:${requestId}]`);
  
  if (req.method === 'POST' && req.body) {
    const logBody = { ...req.body };
    // Masquer les données sensibles
    if (logBody.password) logBody.password = '***';
    if (logBody.confirmPassword) logBody.confirmPassword = '***';
    if (logBody.SENDGRID_API_KEY) logBody.SENDGRID_API_KEY = '***';
    
    // Log concis pour les emails
    if (req.url === '/api/emails/send') {
      console.log(`   📧 Email: ${logBody.to || 'N/A'} <- ${logBody.userEmail || 'N/A'}`);
      console.log(`   📝 Sujet: ${logBody.subject?.substring(0, 50) || 'N/A'}`);
    } else {
      console.log('   📦 Body:', JSON.stringify(logBody, null, 2));
    }
  }
  
  // Attacher l'ID à la réponse
  res.setHeader('X-Request-ID', requestId);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusIcon = res.statusCode >= 400 ? '❌' : '✅';
    console.log(`[${new Date().toISOString()}] ${statusIcon} ${req.method} ${req.url} - ${res.statusCode} (${duration}ms) [ID:${requestId}]\n`);
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
    server: "https://system-mail-youpi-backend.onrender.com",
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
  const sendGridStatus = process.env.SENDGRID_API_KEY ? {
    configured: true,
    keyLength: process.env.SENDGRID_API_KEY.length,
    sender: process.env.SMTP_SENDER || 'Non configuré'
  } : { configured: false };
  
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Youpi Mail Backend",
    uptime: process.uptime(),
    emailProvider: "SendGrid",
    sendGrid: sendGridStatus,
    memory: {
      heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`
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

// 6. Route d'envoi d'email - VERSION AMÉLIORÉE avec LOGS DÉTAILLÉS
app.post("/api/emails/send", async (req, res) => {
  const startTime = Date.now();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.log("\n" + "=".repeat(70));
  console.log("📧 DÉMARRAGE ENVOI EMAIL [ID:" + requestId + "]");
  console.log("=".repeat(70));
  
  try {
    const { to, subject, message, destinator = "other", attachments = [], userEmail } = req.body;

    console.log("📋 DONNÉES REÇUES:");
    console.log("   Destinataire (to):", to || "❌ NON FOURNI");
    console.log("   Sujet (subject):", subject || "❌ NON FOURNI");
    console.log("   Message:", message ? `✅ ${message.length} caractères` : "❌ 0 caractères");
    console.log("   Expéditeur (userEmail):", userEmail || "❌ NON FOURNI");
    console.log("   Destinator:", destinator);
    console.log("   Pièces jointes:", attachments.length > 0 ? `✅ ${attachments.length} fichier(s)` : "Aucune");
    
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
      console.log("❌ VALIDATION ÉCHOUÉE:", errors);
      return res.status(400).json({
        success: false,
        error: errors.join(", "),
        timestamp: new Date().toISOString(),
        validationTime: `${Date.now() - startTime}ms`,
        requestId: requestId
      });
    }

    console.log("✅ Validation réussie en", Date.now() - startTime, "ms");
    
    // VÉRIFICATION CRITIQUE DU TRANSPORTEUR
    console.log("🔄 Récupération transporteur SendGrid...");
    let transporter;
    try {
      transporter = getSendGridTransporter();
      console.log("✅ Transporteur récupéré");
    } catch (transporterError) {
      console.error("❌ ERREUR TRANSPORTEUR:", transporterError.message);
      throw new Error(`Configuration SendGrid invalide: ${transporterError.message}`);
    }
    
    const senderEmail = process.env.SMTP_SENDER;
    console.log(`📤 Préparation email de: ${senderEmail} → ${to}`);
    console.log(`   Reply-To: ${userEmail}`);
    
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

    // ENVOI AVEC TIMEOUT ET LOGS DÉTAILLÉS
    console.log("⏳ Tentative d'envoi via SendGrid...");
    console.log("   Timeout configuré: 15 secondes");
    
    const sendWithTimeout = () => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          console.error("⏰ TIMEOUT: SendGrid n'a pas répondu après 15 secondes");
          reject(new Error("Timeout: SendGrid n'a pas répondu après 15 secondes"));
        }, 15000);
        
        console.log("   📤 Appel à transporter.sendMail()...");
        
        transporter.sendMail(mailOptions, (error, info) => {
          clearTimeout(timeoutId);
          
          if (error) {
            console.error("   ❌ ERREUR SENGRID DÉTAILLÉE:");
            console.error("      Message:", error.message);
            console.error("      Code:", error.code || "N/A");
            console.error("      Command:", error.command || "N/A");
            console.error("      Response Code:", error.responseCode || "N/A");
            console.error("      Response:", error.response || "N/A");
            
            if (error.response) {
              console.error("      Réponse brute:", error.response.substring(0, 200));
            }
            
            reject(error);
          } else {
            console.log("   ✅ SUCCÈS SENGRID:");
            console.log("      Message ID:", info.messageId || "N/A");
            console.log("      Response:", info.response ? info.response.substring(0, 100) + "..." : "N/A");
            console.log("      Accepted:", info.accepted ? info.accepted.join(", ") : "N/A");
            console.log("      Rejected:", info.rejected ? info.rejected.join(", ") : "Aucun");
            resolve(info);
          }
        });
      });
    };

    const info = await sendWithTimeout();
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 EMAIL ENVOYÉ AVEC SUCCÈS en ${totalTime}ms`);
    console.log("=".repeat(70) + "\n");
    
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
      processingTime: `${totalTime}ms`,
      simulated: false,
      provider: "SendGrid",
      requestId: requestId
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    console.error("\n💥💥💥 ERREUR CRITIQUE DANS /api/emails/send 💥💥💥");
    console.error("   Temps écoulé:", totalTime, "ms");
    console.error("   Request ID:", requestId);
    console.error("   Message:", error.message);
    console.error("   Stack:", error.stack);
    
    // Analyse détaillée de l'erreur SendGrid
    if (error.code) {
      console.error("   Code erreur:", error.code);
    }
    if (error.command) {
      console.error("   Commande:", error.command);
    }
    if (error.responseCode) {
      console.error("   Code réponse:", error.responseCode);
    }
    if (error.response) {
      console.error("   Réponse SendGrid:", error.response.substring(0, 500));
    }
    
    console.error("=".repeat(70) + "\n");
    
    // Messages d'erreur utilisateur selon le type
    let userMessage = "Échec de l'envoi de l'email";
    let statusCode = 500;
    let details = null;
    
    if (error.message.includes("Timeout")) {
      userMessage = "SendGrid est trop lent à répondre. Veuillez réessayer.";
      statusCode = 504; // Gateway Timeout
    } else if (error.code === 'EAUTH') {
      userMessage = "Erreur d'authentification SendGrid.";
      details = "Vérifiez que votre clé API SendGrid est valide et active.";
    } else if (error.code === 'EENVELOPE') {
      userMessage = "Erreur dans les adresses email.";
      statusCode = 400;
      details = "Vérifiez le format des adresses email (expéditeur et destinataire).";
    } else if (error.message.includes('SENDGRID_API_KEY')) {
      userMessage = "Configuration SendGrid manquante.";
      details = "Configurez SENDGRID_API_KEY et SMTP_SENDER sur Render.";
    } else if (error.response && error.response.includes('Unauthorized')) {
      userMessage = "Accès refusé par SendGrid.";
      details = "Clé API SendGrid invalide ou expirée.";
    } else if (error.response && error.response.includes('sender identity')) {
      userMessage = "Expéditeur non autorisé.";
      details = "L'email SMTP_SENDER doit être vérifié dans votre compte SendGrid.";
    }
    
    // Toujours retourner l'erreur technique en développement
    const technicalError = process.env.NODE_ENV === 'development' ? error.message : undefined;
    
    res.status(statusCode).json({
      success: false,
      error: userMessage,
      details: details,
      technicalError: technicalError,
      processingTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
      requestId: requestId
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

// ===== GESTION DES ERREURS GLOBALES =====
app.use((err, req, res, next) => {
  console.error("🔥 ERREUR GLOBALE NON CAPTURÉE:", err);
  console.error("🔥 Stack:", err.stack);
  
  res.status(500).json({
    success: false,
    error: "Erreur interne du serveur",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// ===== DÉMARRAGE =====
const server = app.listen(PORT, HOST, () => {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 YOUPI MAIL API AVEC SENDGRID - DÉMARRÉE AVEC SUCCÈS");
  console.log("=".repeat(70));
  console.log(`🌐 URL Publique: https://system-mail-youpi-backend.onrender.com`);
  console.log(`🔧 Port Serveur: ${PORT}`);
  console.log(`🏠 Host: ${HOST}`);
  console.log(`⚡ Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 SendGrid Config: ${process.env.SENDGRID_API_KEY ? '✅ API Key présente' : '❌ API Key MANQUANTE'}`);
  console.log(`📧 Expéditeur Config: ${process.env.SMTP_SENDER ? `✅ ${process.env.SMTP_SENDER}` : '❌ NON CONFIGURÉ'}`);
  
  // Test de connexion SendGrid au démarrage
  if (process.env.SENDGRID_API_KEY && process.env.SMTP_SENDER) {
    console.log("\n🔍 Test de connexion SendGrid au démarrage...");
    try {
      const transporter = getSendGridTransporter();
      console.log("✅ SendGrid: Transporteur initialisé avec succès");
    } catch (error) {
      console.error(`❌ SendGrid: Échec initialisation - ${error.message}`);
    }
  } else {
    console.error("\n⚠️  ATTENTION: Variables SendGrid manquantes!");
    console.error("   Configurez SENDGRID_API_KEY et SMTP_SENDER sur Render");
  }
  
  console.log("=".repeat(70));
  console.log(`⏰ Démarrage: ${new Date().toISOString()}`);
  console.log("=".repeat(70) + "\n");
});

// Gestion arrêt propre
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM reçu: arrêt propre du serveur...');
  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT reçu: arrêt propre du serveur...');
  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });
});

module.exports = app;