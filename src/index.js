const sgMail = require('@sendgrid/mail');
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

// ===== CONFIGURATION SENDGRID API (WEB API) =====
const initializeSendGridClient = () => {
  console.log("=".repeat(60));
  console.log("🔄 INITIALISATION CLIENT SENDGRID API");
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
  
  console.log("⚙️  Configuration du client SendGrid API...");
  
  try {
    // Configuration unique du client SendGrid
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    console.log("✅ Client SendGrid API initialisé avec succès");
    console.log("=".repeat(60));
    
    return sgMail;
  } catch (transportError) {
    console.error("❌ ERREUR initialisation client SendGrid:", transportError.message);
    console.error("❌ Stack:", transportError.stack);
    throw transportError;
  }
};

// Initialiser le client une seule fois
let sendGridClient = null;
const getSendGridClient = () => {
  if (!sendGridClient) {
    try {
      sendGridClient = initializeSendGridClient();
    } catch (error) {
      console.error("💥 ERREUR FATALE: Impossible de créer le client SendGrid API");
      sendGridClient = null;
      throw error;
    }
  }
  return sendGridClient;
};

// Fonction pour envoyer un email via l'API SendGrid
const sendEmailViaAPI = async (emailData) => {
  const client = getSendGridClient();
  
  // Construction du message selon le format SendGrid API
  const msg = {
    to: emailData.to,
    from: {
      email: process.env.SMTP_SENDER,
      name: emailData.senderName || 'Youpi Mail'
    },
    subject: emailData.subject,
    text: emailData.text,
    html: emailData.html,
    replyTo: emailData.replyTo || process.env.SMTP_SENDER,
  };
  
  try {
    const response = await client.send(msg);
    return {
      success: true,
      messageId: response[0].headers['x-message-id'],
      statusCode: response[0].statusCode,
      headers: response[0].headers
    };
  } catch (error) {
    console.error("❌ Erreur SendGrid API:", error.message);
    if (error.response) {
      console.error("❌ Détails:", JSON.stringify(error.response.body, null, 2));
    }
    throw error;
  }
};

// Fonction pour encoder l'image en Base64
const getBannerImageBase64 = () => {
  try {
    const assetsPath = path.join(__dirname, 'assets');
    
    // Liste des fichiers à rechercher (par ordre de priorité)
    const possibleFiles = [
      'banniere.jpg', 'banniere.png', 'banniere.jpeg',
      'banner.jpg', 'banner.png', 'banner.jpeg',
      'header.jpg', 'header.png', 'header.jpeg',
      'baniere.png', 'baniere.jpg', 'baniere.jpeg'  // Ajout de votre nom de fichier
    ];
    
    let imageFound = null;
    let imageExtension = 'jpg';
    
    // Rechercher le fichier d'image
    for (const file of possibleFiles) {
      const filePath = path.join(assetsPath, file);
      if (fs.existsSync(filePath)) {
        imageFound = filePath;
        imageExtension = path.extname(file).toLowerCase().substring(1); // .jpg -> jpg
        console.log(`✅ Image trouvée: ${file} (${imageExtension})`);
        break;
      }
    }
    
    if (!imageFound) {
      console.warn("⚠️ Aucune image de bannière trouvée dans /assets/");
      return null;
    }
    
    // Lire et encoder l'image en Base64
    const imageBuffer = fs.readFileSync(imageFound);
    const base64Image = imageBuffer.toString('base64');
    
    // Déterminer le type MIME correct
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp'
    };
    
    const mimeType = mimeTypes[imageExtension] || 'image/jpeg';
    
    return `data:${mimeType};base64,${base64Image}`;
    
  } catch (error) {
    console.error("❌ Erreur lors du chargement de l'image:", error.message);
    return null;
  }
};

// ===== MIDDLEWARES =====
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware pour servir les fichiers statiques depuis assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

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
    message: "🚀 Youpi Mail API avec SendGrid API",
    status: "online",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    emailProvider: "SendGrid Web API",
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
    method: "Web API (HTTPS)",
    keyLength: process.env.SENDGRID_API_KEY.length,
    sender: process.env.SMTP_SENDER || 'Non configuré'
  } : { configured: false, method: "N/A" };
  
  // Tester si une image de bannière est disponible
  const base64Image = getBannerImageBase64();
  const bannerInfo = base64Image ? {
    exists: true,
    format: "Base64 (inline dans l'email)",
    size: `${Math.round(base64Image.length / 1024)} KB`
  } : {
    exists: false,
    format: "Non disponible"
  };
  
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Youpi Mail Backend",
    uptime: process.uptime(),
    emailProvider: "SendGrid Web API",
    sendGrid: sendGridStatus,
    banner: bannerInfo,
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
      sendGridConfig: {
        method: "Web API",
        sender: process.env.SMTP_SENDER || "Non configuré"
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

// 6. Route d'envoi d'email - VERSION AVEC IMAGE BASE64
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
    
    // VÉRIFICATION CRITIQUE DU CLIENT SENDGRID
    console.log("🔄 Récupération client SendGrid API...");
    let client;
    try {
      client = getSendGridClient();
      console.log("✅ Client SendGrid API récupéré");
    } catch (clientError) {
      console.error("❌ ERREUR CLIENT SENDGRID:", clientError.message);
      throw new Error(`Configuration SendGrid invalide: ${clientError.message}`);
    }
    
    const senderEmail = process.env.SMTP_SENDER;
    console.log(`📤 Préparation email via API Web: ${senderEmail} → ${to}`);
    console.log(`   Reply-To: ${userEmail}`);
    
    // OBTENIR L'IMAGE EN BASE64
    console.log("🖼️  Chargement de l'image en Base64...");
    const base64Image = getBannerImageBase64();
    
    if (base64Image) {
      console.log(`✅ Image chargée avec succès (${Math.round(base64Image.length / 1024)} KB)`);
    } else {
      console.log("ℹ️  Aucune image disponible, utilisation du titre par défaut");
    }
    
    // Génération du HTML selon le destinator
    let htmlContent = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
            body {
                font-family: 'Arial', sans-serif;
                margin: 0;
                padding: 0;
                background-color: #f5f5f5;
                line-height: 1.6;
            }
            .email-container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }
            .header {
                background-color: #007AFF;
                ${base64Image ? 'padding: 0;' : 'padding: 20px;'}
                text-align: center;
            }
            .banner {
                width: 100%;
                max-height: 200px;
                object-fit: cover;
                border-radius: 0;
                display: block;
            }
            .header-title {
                color: white;
                font-size: 24px;
                margin: 0;
                padding: 20px;
            }
            .content {
                padding: 30px;
                color: #333333;
            }
            .subject {
                color: #007AFF;
                font-size: 24px;
                margin-top: 0;
                margin-bottom: 20px;
                font-weight: bold;
            }
            .message {
                color: #555555;
                font-size: 16px;
                line-height: 1.8;
                white-space: pre-line;
            }
            .divider {
                height: 1px;
                background-color: #eeeeee;
                margin: 30px 0;
            }
            .sender-info {
                background-color: #f9f9f9;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #007AFF;
                margin-top: 30px;
            }
            .footer {
                background-color: #2c3e50;
                color: #ffffff;
                padding: 25px;
                text-align: center;
            }
            .contact-info {
                margin-bottom: 15px;
                font-size: 14px;
            }
            .phone-numbers {
                font-weight: bold;
                color: #007AFF;
                margin: 10px 0;
                line-height: 1.8;
            }
            .copyright {
                font-size: 12px;
                color: #95a5a6;
                margin-top: 15px;
                border-top: 1px solid #34495e;
                padding-top: 15px;
            }
            .youpi-badge {
                display: inline-block;
                background-color: #007AFF;
                color: white;
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 12px;
                margin-top: 10px;
            }
            @media (max-width: 600px) {
                .content {
                    padding: 20px;
                }
                .subject {
                    font-size: 20px;
                }
                .message {
                    font-size: 14px;
                }
                .phone-numbers {
                    font-size: 14px;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <!-- HEADER AVEC BANNIÈRE EN BASE64 -->
            <div class="header">
                ${base64Image ? 
                  `<img src="${base64Image}" 
                        alt="Bannière Youpi Mail" 
                        class="banner">` : 
                  `<h1 class="header-title">✉️ Youpi Mail</h1>`}
            </div>
            
            <!-- CONTENU PRINCIPAL -->
            <div class="content">
                <h1 class="subject">${subject}</h1>
                
                <div class="message">
                    ${message.replace(/\n/g, '<br>')}
                </div>
                
                <div class="divider"></div>
                
                <!-- INFO EXPÉDITEUR -->
                <div class="sender-info">
                    <p><strong>Expéditeur :</strong> ${userEmail}</p>
                    <div class="youpi-badge">Envoyé via Youpi Mail</div>
                </div>
            </div>
            
            <!-- FOOTER AVEC COORDONNÉES -->
            <div class="footer">
                <div class="contact-info">
                    <p>Besoin d'aide ? Contactez-nous :</p>
                    <div class="phone-numbers">
                        +243 856 163 550<br>
                        +243 834 171 852
                    </div>
                </div>
                
                <div class="copyright">
                    © ${new Date().getFullYear()} Youpi Mail. Tous droits réservés.<br>
                    <small>Service d'envoi d'emails professionnels</small>
                </div>
            </div>
        </div>
    </body>
    </html>`;

    // ENVOI VIA SENDGRID WEB API
    console.log("⏳ Tentative d'envoi via SendGrid Web API...");
    console.log("   Méthode: HTTPS (port 443)");
    console.log("   Image: ${base64Image ? 'Intégrée (Base64)' : 'Titre par défaut'}");
    
    const emailData = {
      to: to,
      subject: subject,
      text: message,
      html: htmlContent,
      replyTo: userEmail,
      senderName: 'Youpi Mail'
    };

    const sendStartTime = Date.now();
    const result = await sendEmailViaAPI(emailData);
    const sendTime = Date.now() - sendStartTime;
    
    console.log(`✅ EMAIL ENVOYÉ AVEC SUCCÈS en ${sendTime}ms`);
    console.log(`   Message ID: ${result.messageId || 'N/A'}`);
    console.log(`   Status Code: ${result.statusCode}`);
    console.log("=".repeat(70) + "\n");
    
    const totalTime = Date.now() - startTime;
    
    // Réponse au client
    res.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
      details: `Email envoyé avec succès de "${senderEmail}" à "${to}" via SendGrid Web API`,
      from: senderEmail,
      replyTo: userEmail,
      to: to,
      subject: subject,
      processingTime: `${totalTime}ms`,
      sendMethod: "SendGrid Web API (HTTPS)",
      imageMethod: base64Image ? "Base64 (Intégrée)" : "Titre par défaut",
      requestId: requestId
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    console.error("\n💥💥💥 ERREUR D'ENVOI EMAIL 💥💥💥");
    console.error("   Temps écoulé:", totalTime, "ms");
    console.error("   Request ID:", requestId);
    console.error("   Message:", error.message);
    
    // Messages d'erreur utilisateur selon le type
    let userMessage = "Échec de l'envoi de l'email";
    let statusCode = 500;
    let details = null;
    
    if (error.message.includes("API key")) {
      userMessage = "Clé API SendGrid invalide";
      details = "Vérifiez que votre SENDGRID_API_KEY est correcte et active.";
    } else if (error.response && error.response.statusCode === 401) {
      userMessage = "Non autorisé";
      details = "La clé API SendGrid est incorrecte ou expirée.";
    } else if (error.response && error.response.statusCode === 403) {
      userMessage = "Accès interdit";
      details = "Vérifiez que l'expéditeur est autorisé dans votre compte SendGrid.";
    } else if (error.message.includes("sender")) {
      userMessage = "Expéditeur non autorisé";
      details = "L'adresse SMTP_SENDER doit être vérifiée dans SendGrid.";
    } else {
      userMessage = "Erreur lors de l'envoi de l'email";
    }
    
    console.error("=".repeat(70) + "\n");
    
    res.status(statusCode).json({
      success: false,
      error: userMessage,
      details: details,
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
  console.log("🚀 YOUPI MAIL API AVEC SENDGRID WEB API - DÉMARRÉE AVEC SUCCÈS");
  console.log("=".repeat(70));
  console.log(`🌐 URL Publique: https://system-mail-youpi-backend.onrender.com`);
  console.log(`🔧 Port Serveur: ${PORT}`);
  console.log(`🏠 Host: ${HOST}`);
  console.log(`⚡ Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 SendGrid Config: ${process.env.SENDGRID_API_KEY ? '✅ API Key présente' : '❌ API Key MANQUANTE'}`);
  console.log(`📧 Expéditeur Config: ${process.env.SMTP_SENDER ? `✅ ${process.env.SMTP_SENDER}` : '❌ NON CONFIGURÉ'}`);
  console.log(`📡 Méthode d'envoi: SendGrid Web API (HTTPS - Port 443)`);
  
  // Créer le dossier assets s'il n'existe pas
  const assetsPath = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsPath)) {
    fs.mkdirSync(assetsPath, { recursive: true });
    console.log(`📁 Dossier assets créé: ${assetsPath}`);
  }
  
  // Vérifier si des images sont disponibles
  console.log("\n🔍 Recherche d'images dans /assets/");
  const possibleFiles = [
    'banniere.jpg', 'banniere.png', 'banniere.jpeg',
    'banner.jpg', 'banner.png', 'banner.jpeg',
    'header.jpg', 'header.png', 'header.jpeg',
    'baniere.png', 'baniere.jpg', 'baniere.jpeg'
  ];
  
  let imageFound = false;
  for (const file of possibleFiles) {
    const filePath = path.join(assetsPath, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`✅ Image trouvée: /assets/${file} (${Math.round(stats.size / 1024)} KB)`);
      imageFound = true;
      break;
    }
  }
  
  if (!imageFound) {
    console.warn("⚠️  Aucune image de bannière trouvée dans /assets/");
    console.warn("   Placez votre image (banniere.jpg, banniere.png, etc.) dans le dossier assets");
  }
  
  // Tester le chargement Base64
  console.log("\n🔍 Test de chargement Base64...");
  const base64Image = getBannerImageBase64();
  if (base64Image) {
    console.log(`✅ Base64 fonctionnel: ${Math.round(base64Image.length / 1024)} KB`);
  } else {
    console.log("ℹ️  Aucune image disponible pour le Base64");
  }
  
  // Test de connexion SendGrid au démarrage
  if (process.env.SENDGRID_API_KEY && process.env.SMTP_SENDER) {
    console.log("\n🔍 Test de configuration SendGrid API...");
    try {
      const client = getSendGridClient();
      console.log("✅ SendGrid: Client API initialisé avec succès");
      console.log("✅ IMPORTANT: Pas de timeout SMTP - Utilisation HTTPS (port 443)");
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