const sgMail = require('@sendgrid/mail');
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require('bcrypt'); // Nouveau : Pour hacher les mots de passe
const { Pool } = require('pg');   // Nouveau : Pour PostgreSQL

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

// ===== CONFIGURATION DE LA BASE DE DONNÉES =====
let dbPool;
const initializeDatabase = () => {
  console.log("=".repeat(60));
  console.log("🗄️  INITIALISATION BASE DE DONNÉES POSTGRESQL");
  console.log("=".repeat(60));
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERREUR: DATABASE_URL non définie sur Render');
    console.error('   ➡️ Créez une base PostgreSQL et ajoutez DATABASE_URL dans Environment');
    throw new Error("Configuration base de données manquante");
  }
  
  try {
    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false // Nécessaire pour Render
      }
    });
    
    // Tester la connexion
    dbPool.query('SELECT NOW()', (err) => {
      if (err) {
        console.error('❌ Connexion PostgreSQL échouée:', err.message);
        throw err;
      }
      console.log('✅ PostgreSQL connecté avec succès');
    });
    
    console.log("=".repeat(60));
    return dbPool;
  } catch (dbError) {
    console.error("💥 ERREUR FATALE PostgreSQL:", dbError.message);
    throw dbError;
  }
};

// ===== CONFIGURATION SENDGRID API =====
const initializeSendGridClient = () => {
  console.log("=".repeat(60));
  console.log("🔄 INITIALISATION CLIENT SENDGRID API");
  console.log("=".repeat(60));
  
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ ERREUR: SENDGRID_API_KEY non définie');
    throw new Error("SENDGRID_API_KEY manquante");
  }
  
  if (!process.env.SMTP_SENDER) {
    console.error('❌ ERREUR: SMTP_SENDER non définie');
    throw new Error("SMTP_SENDER manquante");
  }
  
  console.log("✅ SENDGRID_API_KEY: Présente");
  console.log("✅ SMTP_SENDER:", process.env.SMTP_SENDER);
  
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log("✅ Client SendGrid API initialisé");
    console.log("=".repeat(60));
    return sgMail;
  } catch (error) {
    console.error("❌ Erreur SendGrid:", error.message);
    throw error;
  }
};

// Initialiser les clients
let sendGridClient = null;
const getSendGridClient = () => {
  if (!sendGridClient) sendGridClient = initializeSendGridClient();
  return sendGridClient;
};

const initializeServices = async () => {
  try {
    initializeDatabase();      // 1. Base de données
    getSendGridClient();       // 2. SendGrid
    await createTables();      // 3. Créer les tables
    console.log("🚀 Tous les services sont prêts !");
  } catch (error) {
    console.error("💥 Échec initialisation:", error);
    process.exit(1);
  }
};

// ===== CRÉATION DES TABLES =====
const createTables = async () => {
  const createTablesSQL = `
    -- Table utilisateurs
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Table emails
    CREATE TABLE IF NOT EXISTS emails (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      to_email VARCHAR(255) NOT NULL,
      subject TEXT,
      content TEXT,
      status VARCHAR(50) DEFAULT 'draft',
      error_detail TEXT,
      sendgrid_message_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Table pièces jointes
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
      filename VARCHAR(255),
      file_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
  
  try {
    await dbPool.query(createTablesSQL);
    console.log("✅ Tables créées avec succès");
  } catch (error) {
    console.error("❌ Erreur création tables:", error.message);
    throw error;
  }
};

// ===== FONCTION UTILITAIRE : ENVOI D'EMAIL =====
const sendEmailViaAPI = async (emailData) => {
  const client = getSendGridClient();
  
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
      statusCode: response[0].statusCode
    };
  } catch (error) {
    console.error("❌ Erreur SendGrid:", error.message);
    throw error;
  }
};

// ===== MIDDLEWARES =====
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Middleware de logging
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url} [ID:${requestId}]`);
  res.setHeader('X-Request-ID', requestId);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${res.statusCode >= 400 ? '❌' : '✅'} ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)\n`);
  });
  
  next();
});

// ===== ROUTES D'AUTHENTIFICATION =====

// 1. Inscription
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    console.log("📝 Inscription:", { email, name: name || email.split('@')[0] });
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email et mot de passe requis" });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: "Format email invalide" });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Mot de passe trop court (min 6 caractères)" });
    }
    
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await dbPool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, error: "Un compte existe déjà avec cet email" });
    }
    
    // Hacher le mot de passe
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    // Sauvegarder l'utilisateur
    const result = await dbPool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, password_hash, name || email.split('@')[0]]
    );
    
    // Générer un token simple (remplacez par JWT si besoin)
    const token = `user_${result.rows[0].id}_${Date.now()}`;
    
    res.json({
      success: true,
      message: "Compte créé avec succès",
      token: token,
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur inscription:", error);
    res.status(500).json({ success: false, error: "Erreur serveur lors de l'inscription" });
  }
});

// 2. Connexion
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log("🔐 Connexion:", { email });
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email et mot de passe requis" });
    }
    
    // Chercher l'utilisateur
    const result = await dbPool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect" });
    }
    
    const user = result.rows[0];
    
    // Vérifier le mot de passe
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect" });
    }
    
    // Générer le token
    const token = `user_${user.id}_${Date.now()}`;
    
    res.json({
      success: true,
      message: "Connexion réussie",
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at
      }
    });
    
  } catch (error) {
    console.error("❌ Erreur connexion:", error);
    res.status(500).json({ success: false, error: "Erreur serveur lors de la connexion" });
  }
});

// 3. Supprimer un utilisateur
app.delete("/api/auth/delete/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const { password } = req.body; // Demander confirmation par mot de passe
    
    if (!password) {
      return res.status(400).json({ success: false, error: "Mot de passe requis pour suppression" });
    }
    
    // Vérifier l'utilisateur et son mot de passe
    const userResult = await dbPool.query('SELECT password_hash FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    
    const passwordMatch = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: "Mot de passe incorrect" });
    }
    
    // Supprimer l'utilisateur (CASCADE supprimera aussi ses emails)
    await dbPool.query('DELETE FROM users WHERE id = $1', [user_id]);
    
    res.json({
      success: true,
      message: "Compte supprimé avec succès"
    });
    
  } catch (error) {
    console.error("❌ Erreur suppression utilisateur:", error);
    res.status(500).json({ success: false, error: "Erreur serveur lors de la suppression" });
  }
});

// ===== ROUTES EMAIL =====

// 1. Envoyer un email
app.post("/api/emails/send", async (req, res) => {
  const startTime = Date.now();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.log(`\n📧 ENVOI EMAIL [ID:${requestId}]`);
  
  try {
    const { user_id, to, subject, message, userEmail } = req.body;
    
    // Validation
    if (!user_id || !to || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: "Données manquantes: user_id, to, subject et message sont requis"
      });
    }
    
    // Vérifier que l'utilisateur existe
    const userResult = await dbPool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    
    // Envoyer via SendGrid
    const sendResult = await sendEmailViaAPI({
      to: to,
      subject: subject,
      text: message,
      html: `<div>${message.replace(/\n/g, '<br>')}</div>`,
      replyTo: userEmail || process.env.SMTP_SENDER,
      senderName: 'Youpi Mail'
    });
    
    // Sauvegarder dans la base de données
    const emailResult = await dbPool.query(
      `INSERT INTO emails (user_id, to_email, subject, content, status, sendgrid_message_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, created_at`,
      [user_id, to, subject, message, 'sent', sendResult.messageId]
    );
    
    const totalTime = Date.now() - startTime;
    
    res.json({
      success: true,
      message: "Email envoyé et sauvegardé",
      email_id: emailResult.rows[0].id,
      sendgrid_message_id: sendResult.messageId,
      processingTime: `${totalTime}ms`,
      requestId: requestId
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    // En cas d'erreur SendGrid, sauvegarder quand même avec statut 'failed'
    if (req.body.user_id) {
      try {
        await dbPool.query(
          `INSERT INTO emails (user_id, to_email, subject, content, status, error_detail) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.body.user_id, req.body.to, req.body.subject, req.body.message, 'failed', error.message]
        );
      } catch (dbError) {
        console.error("❌ Erreur sauvegarde email échoué:", dbError);
      }
    }
    
    console.error(`💥 Erreur envoi email [${requestId}]:`, error.message);
    
    res.status(500).json({
      success: false,
      error: "Échec de l'envoi de l'email",
      details: error.message,
      processingTime: `${totalTime}ms`,
      requestId: requestId
    });
  }
});

// 2. Récupérer les emails d'un utilisateur
app.get("/api/emails/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status } = req.query; // Optionnel: filtrer par statut
    
    let query = 'SELECT * FROM emails WHERE user_id = $1';
    const params = [user_id];
    
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await dbPool.query(query, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      emails: result.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération emails:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 3. Supprimer un email
app.delete("/api/emails/:email_id", async (req, res) => {
  try {
    const { email_id } = req.params;
    
    const result = await dbPool.query('DELETE FROM emails WHERE id = $1 RETURNING id', [email_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Email non trouvé" });
    }
    
    res.json({
      success: true,
      message: "Email supprimé",
      email_id: result.rows[0].id
    });
    
  } catch (error) {
    console.error("❌ Erreur suppression email:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 4. Modifier un email (brouillon)
app.put("/api/emails/:email_id", async (req, res) => {
  try {
    const { email_id } = req.params;
    const { subject, content } = req.body;
    
    if (!subject && !content) {
      return res.status(400).json({ success: false, error: "Aucune donnée à modifier" });
    }
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (subject) {
      updates.push(`subject = $${paramCount}`);
      values.push(subject);
      paramCount++;
    }
    
    if (content) {
      updates.push(`content = $${paramCount}`);
      values.push(content);
      paramCount++;
    }
    
    values.push(email_id);
    
    const query = `UPDATE emails SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await dbPool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Email non trouvé" });
    }
    
    res.json({
      success: true,
      message: "Email modifié",
      email: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur modification email:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====

// Route racine
app.get("/", (req, res) => {
  res.json({
    message: "🚀 Youpi Mail API avec Base de Données",
    status: "online",
    version: "3.0.0",
    timestamp: new Date().toISOString(),
    features: ["PostgreSQL", "SendGrid API", "Authentification", "Gestion emails"],
    endpoints: {
      auth: ["POST /api/auth/register", "POST /api/auth/login", "DELETE /api/auth/delete/:user_id"],
      emails: ["POST /api/emails/send", "GET /api/emails/:user_id", "PUT /api/emails/:email_id", "DELETE /api/emails/:email_id"],
      utils: ["GET /api/health", "GET /api/setup-database"]
    }
  });
});

// Route santé
app.get("/api/health", async (req, res) => {
  try {
    // Tester la base de données
    const dbResult = await dbPool.query('SELECT NOW() as db_time');
    
    // Tester SendGrid (simplifié)
    const sendgridStatus = process.env.SENDGRID_API_KEY ? "configuré" : "non configuré";
    
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      services: {
        database: "connecté",
        sendgrid: sendgridStatus,
        server_time: new Date().toISOString(),
        db_time: dbResult.rows[0].db_time
      },
      memory: {
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`
      }
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      error: error.message
    });
  }
});

// Route pour créer les tables (à appeler une fois)
app.get("/api/setup-database", async (req, res) => {
  try {
    await createTables();
    res.json({ success: true, message: "Base de données configurée avec succès" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée: ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

// Gestion erreurs globales
app.use((err, req, res, next) => {
  console.error("🔥 Erreur globale:", err);
  res.status(500).json({
    success: false,
    error: "Erreur interne du serveur",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===== DÉMARRAGE =====
const startServer = async () => {
  try {
    await initializeServices();
    
    const server = app.listen(PORT, HOST, () => {
      console.log("\n" + "=".repeat(70));
      console.log("🚀 YOUPI MAIL API - DÉMARRÉE AVEC SUCCÈS");
      console.log("=".repeat(70));
      console.log(`🌐 URL: https://system-mail-youpi-backend.onrender.com`);
      console.log(`🔧 Port: ${PORT}`);
      console.log(`🗄️  Base de données: ${process.env.DATABASE_URL ? '✅ Configurée' : '❌ Manquante'}`);
      console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? '✅ Configuré' : '❌ Manquant'}`);
      console.log("=".repeat(70));
    });
    
    // Gestion arrêt propre
    process.on('SIGTERM', () => {
      console.log('\n🛑 Arrêt du serveur...');
      server.close(() => {
        console.log('✅ Serveur arrêté');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error("💥 Impossible de démarrer le serveur:", error);
    process.exit(1);
  }
};

startServer();

module.exports = app;