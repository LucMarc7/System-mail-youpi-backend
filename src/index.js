const sgMail = require('@sendgrid/mail');
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;
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
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });
    
    console.log('✅ Pool PostgreSQL créé');
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

// Fonction pour tester la connexion à la base de données
const testDatabaseConnection = async () => {
  try {
    const client = await dbPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ PostgreSQL connecté avec succès');
    return true;
  } catch (err) {
    console.error('❌ Connexion PostgreSQL échouée:', err.message);
    return false;
  }
};

// ===== CRÉATION/MISE À JOUR DES TABLES =====
const createTables = async () => {
  try {
    // Vérifier si les tables existent déjà
    const tablesExist = await dbPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      )
    `);
    
    if (!tablesExist.rows[0].exists) {
      // Créer les tables si elles n'existent pas
      await createNewTables();
      console.log("✅ Tables créées avec succès");
    } else {
      // Mettre à jour les tables existantes
      await updateExistingTables();
      console.log("✅ Tables mises à jour avec succès");
    }
  } catch (error) {
    console.error("❌ Erreur création/mise à jour tables:", error.message);
    throw error;
  }
};

const createNewTables = async () => {
  const createTablesSQL = `
    -- Table utilisateurs
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Table emails
    CREATE TABLE emails (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      to_email VARCHAR(255) NOT NULL,
      subject TEXT,
      content TEXT,
      status VARCHAR(50) DEFAULT 'draft',
      error_detail TEXT,
      sendgrid_message_id VARCHAR(255),
      folder VARCHAR(50) DEFAULT 'inbox',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Table pièces jointes
    CREATE TABLE attachments (
      id SERIAL PRIMARY KEY,
      email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
      filename VARCHAR(255),
      file_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Créer des index
    CREATE INDEX idx_emails_user_id ON emails(user_id);
    CREATE INDEX idx_emails_folder ON emails(folder);
    CREATE INDEX idx_emails_created_at ON emails(created_at DESC);
  `;
  
  await dbPool.query(createTablesSQL);
};

const updateExistingTables = async () => {
  // Vérifier et ajouter les colonnes manquantes à la table emails
  const checkColumns = await dbPool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'emails'
  `);
  
  const existingColumns = checkColumns.rows.map(row => row.column_name);
  
  // Ajouter la colonne folder si elle n'existe pas
  if (!existingColumns.includes('folder')) {
    console.log("📋 Ajout de la colonne 'folder' à la table emails...");
    await dbPool.query('ALTER TABLE emails ADD COLUMN folder VARCHAR(50) DEFAULT \'inbox\'');
  }
  
  // Ajouter la colonne updated_at si elle n'existe pas
  if (!existingColumns.includes('updated_at')) {
    console.log("📋 Ajout de la colonne 'updated_at' à la table emails...");
    await dbPool.query('ALTER TABLE emails ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()');
  }
  
  // Créer les index s'ils n'existent pas
  const checkIndexes = await dbPool.query(`
    SELECT indexname 
    FROM pg_indexes 
    WHERE tablename = 'emails'
  `);
  
  const existingIndexes = checkIndexes.rows.map(row => row.indexname);
  
  if (!existingIndexes.some(idx => idx.includes('idx_emails_user_id'))) {
    await dbPool.query('CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id)');
  }
  
  if (!existingIndexes.some(idx => idx.includes('idx_emails_folder'))) {
    await dbPool.query('CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)');
  }
  
  if (!existingIndexes.some(idx => idx.includes('idx_emails_created_at'))) {
    await dbPool.query('CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC)');
  }
  
  console.log("✅ Structure de base de données vérifiée et mise à jour");
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
    if (error.response && error.response.body) {
      console.error("Détails SendGrid:", JSON.stringify(error.response.body, null, 2));
    }
    throw error;
  }
};

// ===== MIDDLEWARES =====
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Middleware de logging amélioré
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.originalUrl} [ID:${requestId}]`);
  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    const logBody = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string' && value.length > 100) {
        logBody[key] = value.substring(0, 100) + '...';
      } else if (key === 'password') {
        logBody[key] = '***';
      } else {
        logBody[key] = value;
      }
    }
    console.log(`📦 Body:`, logBody);
  }
  
  res.setHeader('X-Request-ID', requestId);
  
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - start;
    const statusEmoji = res.statusCode >= 400 ? '❌' : '✅';
    console.log(`[${new Date().toISOString()}] ${statusEmoji} ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    originalSend.call(this, body);
  };
  
  next();
});

// ===== MIDDLEWARE D'AUTHENTIFICATION SIMPLIFIÉ =====
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      // Pour les routes GET publiques, continuer sans auth
      if (req.method === 'GET' && (
        req.path === '/' || 
        req.path.startsWith('/api/health') ||
        req.path.startsWith('/api/setup-database')
      )) {
        return next();
      }
      return res.status(401).json({ success: false, error: 'Token manquant' });
    }
    
    // Token simple: user_1_123456789
    const parts = token.split('_');
    if (parts.length !== 3 || parts[0] !== 'user') {
      return res.status(401).json({ success: false, error: 'Token invalide' });
    }
    
    const userId = parseInt(parts[1]);
    if (isNaN(userId)) {
      return res.status(401).json({ success: false, error: 'Token invalide' });
    }
    
    // Vérifier que l'utilisateur existe
    const userResult = await dbPool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
    req.userId = userId;
    next();
  } catch (error) {
    console.error("❌ Erreur authentification:", error);
    res.status(500).json({ success: false, error: 'Erreur d\'authentification' });
  }
};

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
    
    const user = result.rows[0];
    
    // Générer un token simple
    const token = `user_${user.id}_${Date.now()}`;
    
    res.json({
      success: true,
      message: "Compte créé avec succès",
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at
      }
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

// 3. Obtenir le profil utilisateur
app.get("/api/auth/profile", authenticateToken, async (req, res) => {
  try {
    const result = await dbPool.query(
      'SELECT id, email, name, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    
    res.json({
      success: true,
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération profil:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 4. Supprimer un utilisateur
app.delete("/api/auth/delete", authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ success: false, error: "Mot de passe requis pour suppression" });
    }
    
    // Vérifier le mot de passe
    const userResult = await dbPool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    
    const passwordMatch = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: "Mot de passe incorrect" });
    }
    
    // Supprimer l'utilisateur
    await dbPool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    
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

// 1. Envoyer un email (protégé)
app.post("/api/emails/send", authenticateToken, async (req, res) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  console.log(`\n📧 ENVOI EMAIL [ID:${requestId}]`);
  
  try {
    const { to, subject, message, folder = 'sent' } = req.body;
    const user_id = req.userId;
    
    // Validation
    if (!to || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: "Données manquantes: to, subject et message sont requis"
      });
    }
    
    console.log(`📤 Envoi email de user ${user_id} à ${to}`);
    
    // Envoyer via SendGrid
    const sendResult = await sendEmailViaAPI({
      to: to,
      subject: subject,
      text: message,
      html: `<div>${message.replace(/\n/g, '<br>')}</div>`,
      replyTo: process.env.SMTP_SENDER,
      senderName: 'Youpi Mail'
    });
    
    // Sauvegarder dans la base de données
    const emailResult = await dbPool.query(
      `INSERT INTO emails (user_id, to_email, subject, content, status, sendgrid_message_id, folder) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, created_at`,
      [user_id, to, subject, message, 'sent', sendResult.messageId, folder]
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
    if (req.userId) {
      try {
        await dbPool.query(
          `INSERT INTO emails (user_id, to_email, subject, content, status, error_detail, folder) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.userId, req.body.to, req.body.subject, req.body.message, 'failed', error.message, 'failed']
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

// 2. Récupérer les emails d'un utilisateur (protégé)
app.get("/api/emails", authenticateToken, async (req, res) => {
  try {
    const user_id = req.userId;
    const { page = 1, limit = 50, folder, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM emails WHERE user_id = $1';
    const params = [user_id];
    let paramCount = 2;
    
    // Filtrage par dossier
    if (folder && folder !== 'all') {
      query += ` AND folder = $${paramCount}`;
      params.push(folder);
      paramCount++;
    }
    
    // Filtrage par statut
    if (status) {
      query += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    // Recherche
    if (search) {
      query += ` AND (subject ILIKE $${paramCount} OR content ILIKE $${paramCount} OR to_email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    // Compter le total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await dbPool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    
    // Récupérer les données avec pagination
    query += ' ORDER BY created_at DESC LIMIT $' + paramCount + ' OFFSET $' + (paramCount + 1);
    params.push(parseInt(limit), offset);
    
    const result = await dbPool.query(query, params);
    
    res.json({
      success: true,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      emails: result.rows.map(email => ({
        id: email.id,
        to: email.to_email,
        subject: email.subject,
        content: email.content,
        status: email.status,
        folder: email.folder || 'inbox', // Valeur par défaut
        createdAt: email.created_at,
        updatedAt: email.updated_at || email.created_at,
        errorDetail: email.error_detail
      }))
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération emails:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 3. Récupérer un email spécifique (protégé)
app.get("/api/emails/:email_id", authenticateToken, async (req, res) => {
  try {
    const { email_id } = req.params;
    const user_id = req.userId;
    
    const result = await dbPool.query(
      'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
      [email_id, user_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Email non trouvé" });
    }
    
    const email = result.rows[0];
    
    res.json({
      success: true,
      email: {
        id: email.id,
        to: email.to_email,
        subject: email.subject,
        content: email.content,
        status: email.status,
        folder: email.folder || 'inbox',
        createdAt: email.created_at,
        updatedAt: email.updated_at || email.created_at,
        errorDetail: email.error_detail,
        sendgridMessageId: email.sendgrid_message_id
      }
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération email:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 4. Créer un brouillon (protégé)
app.post("/api/emails/draft", authenticateToken, async (req, res) => {
  try {
    const { to, subject, content } = req.body;
    const user_id = req.userId;
    
    const result = await dbPool.query(
      `INSERT INTO emails (user_id, to_email, subject, content, status, folder) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [user_id, to || '', subject || '', content || '', 'draft', 'drafts']
    );
    
    res.json({
      success: true,
      message: "Brouillon créé",
      email: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur création brouillon:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 5. Modifier un email (protégé)
app.put("/api/emails/:email_id", authenticateToken, async (req, res) => {
  try {
    const { email_id } = req.params;
    const user_id = req.userId;
    const { to, subject, content, folder, status } = req.body;
    
    // Vérifier que l'email appartient à l'utilisateur
    const checkResult = await dbPool.query(
      'SELECT id FROM emails WHERE id = $1 AND user_id = $2',
      [email_id, user_id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Email non trouvé" });
    }
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (to !== undefined) {
      updates.push(`to_email = $${paramCount}`);
      values.push(to);
      paramCount++;
    }
    
    if (subject !== undefined) {
      updates.push(`subject = $${paramCount}`);
      values.push(subject);
      paramCount++;
    }
    
    if (content !== undefined) {
      updates.push(`content = $${paramCount}`);
      values.push(content);
      paramCount++;
    }
    
    if (folder !== undefined) {
      updates.push(`folder = $${paramCount}`);
      values.push(folder);
      paramCount++;
    }
    
    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: "Aucune donnée à modifier" });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(email_id);
    
    const query = `UPDATE emails SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await dbPool.query(query, values);
    
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

// 6. Supprimer un email (protégé)
app.delete("/api/emails/:email_id", authenticateToken, async (req, res) => {
  try {
    const { email_id } = req.params;
    const user_id = req.userId;
    
    const result = await dbPool.query(
      'DELETE FROM emails WHERE id = $1 AND user_id = $2 RETURNING id',
      [email_id, user_id]
    );
    
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

// 7. Mettre à jour le dossier d'un email (protégé)
app.patch("/api/emails/:email_id/folder", authenticateToken, async (req, res) => {
  try {
    const { email_id } = req.params;
    const user_id = req.userId;
    const { folder } = req.body;
    
    if (!folder || !['inbox', 'sent', 'drafts', 'pending', 'failed', 'all'].includes(folder)) {
      return res.status(400).json({ success: false, error: "Dossier invalide" });
    }
    
    const result = await dbPool.query(
      'UPDATE emails SET folder = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
      [folder, email_id, user_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Email non trouvé" });
    }
    
    res.json({
      success: true,
      message: "Dossier mis à jour",
      email: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur mise à jour dossier:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====

// Route racine (publique)
app.get("/", (req, res) => {
  res.json({
    message: "🚀 Youpi Mail API avec Base de Données",
    status: "online",
    version: "3.2.0",
    timestamp: new Date().toISOString(),
    features: ["PostgreSQL", "SendGrid API", "Authentification", "Gestion emails", "Dossiers"],
    endpoints: {
      auth: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/auth/profile", "DELETE /api/auth/delete"],
      emails: [
        "GET /api/emails",
        "GET /api/emails/:id",
        "POST /api/emails/send",
        "POST /api/emails/draft",
        "PUT /api/emails/:id",
        "PATCH /api/emails/:id/folder",
        "DELETE /api/emails/:id"
      ],
      utils: ["GET /api/health", "GET /api/setup-database"]
    },
    documentation: "https://system-mail-youpi-backend.onrender.com"
  });
});

// Route santé (publique)
app.get("/api/health", async (req, res) => {
  try {
    // Tester la base de données
    let dbStatus = "❌ non connecté";
    let dbTime = null;
    let tablesInfo = [];
    
    try {
      const dbResult = await dbPool.query('SELECT NOW() as db_time');
      dbStatus = "✅ connecté";
      dbTime = dbResult.rows[0].db_time;
      
      // Vérifier les tables
      const tablesResult = await dbPool.query(`
        SELECT table_name, 
               (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as columns,
               (SELECT COUNT(*) FROM information_schema.indexes WHERE table_name = t.table_name) as indexes
        FROM information_schema.tables t
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      tablesInfo = tablesResult.rows;
    } catch (dbError) {
      console.error("Erreur santé DB:", dbError.message);
    }
    
    // Vérifier SendGrid
    const sendgridStatus = process.env.SENDGRID_API_KEY ? "✅ configuré" : "❌ manquant";
    const smtpSender = process.env.SMTP_SENDER || "❌ manquant";
    
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: dbStatus,
        sendgrid: sendgridStatus,
        smtp_sender: smtpSender,
        server_time: new Date().toISOString(),
        db_time: dbTime
      },
      tables: tablesInfo,
      memory: {
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
        rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`
      }
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Route pour créer les tables (publique - à protéger en production)
app.get("/api/setup-database", async (req, res) => {
  try {
    await createTables();
    res.json({ 
      success: true, 
      message: "Base de données vérifiée et mise à jour avec succès",
      tables: ["users", "emails", "attachments"]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée: ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      "GET /",
      "GET /api/health",
      "POST /api/auth/register",
      "POST /api/auth/login",
      "GET /api/auth/profile (authentifié)",
      "DELETE /api/auth/delete (authentifié)",
      "GET /api/emails (authentifié)",
      "POST /api/emails/send (authentifié)",
      "GET /api/setup-database"
    ]
  });
});

// Gestion erreurs globales
app.use((err, req, res, next) => {
  console.error("🔥 Erreur globale:", err);
  res.status(500).json({
    success: false,
    error: "Erreur interne du serveur",
    message: process.env.NODE_ENV === 'production' ? undefined : err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

// ===== DÉMARRAGE =====

// Variables d'environnement disponibles
console.log("🔍 Démarrage de l'application...");
console.log("📦 Variables d'environnement disponibles:");
console.log("- PORT:", process.env.PORT);
console.log("- DATABASE_URL:", process.env.DATABASE_URL ? "Présente (masquée)" : "Manquante");
console.log("- SENDGRID_API_KEY:", process.env.SENDGRID_API_KEY ? "Présente (masquée)" : "Manquante");
console.log("- SMTP_SENDER:", process.env.SMTP_SENDER || "Manquant");

const initializeServices = async () => {
  try {
    console.log("🔄 Initialisation des services...");
    initializeDatabase();      // 1. Base de données
    getSendGridClient();       // 2. SendGrid
    
    // Tester la connexion à la base de données
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      throw new Error("Impossible de se connecter à la base de données");
    }
    
    await createTables();      // 3. Créer/Mettre à jour les tables
    console.log("🚀 Tous les services sont prêts !");
  } catch (error) {
    console.error("💥 Échec initialisation:", error);
    process.exit(1);
  }
};

// Ajoutez un gestionnaire pour les erreurs non capturées
process.on('uncaughtException', (error) => {
  console.error("💥 ERREUR NON CAPTURÉE:", error);
  console.error("Stack:", error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error("💥 PROMESSE NON GÉRÉE:", reason);
  process.exit(1);
});

const startServer = async () => {
  try {
    console.log("🔄 Initialisation des services...");
    await initializeServices();
    
    console.log("🚀 Démarrage du serveur HTTP...");
    const server = app.listen(PORT, HOST, () => {
      console.log("\n" + "=".repeat(70));
      console.log("🚀 YOUPI MAIL API - DÉMARRÉE AVEC SUCCÈS");
      console.log("=".repeat(70));
      console.log(`🌐 URL: https://system-mail-youpi-backend.onrender.com`);
      console.log(`🔧 Port: ${PORT}`);
      console.log(`📊 Env: ${process.env.NODE_ENV || 'development'}`);
      console.log(`⏰ Démarrage: ${new Date().toISOString()}`);
      console.log("=".repeat(70));
    });
    
    // Gestion des erreurs du serveur
    server.on('error', (error) => {
      console.error("💥 Erreur du serveur HTTP:", error);
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Le port ${PORT} est déjà utilisé`);
      }
    });
    
    // Gestion arrêt propre
    const shutdown = (signal) => {
      console.log(`\n🛑 Signal ${signal} reçu - Arrêt du serveur...`);
      server.close(() => {
        console.log('✅ Serveur arrêté');
        if (dbPool) {
          dbPool.end(() => {
            console.log('✅ Pool de connexions PostgreSQL fermé');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      });
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    console.error("💥 IMPOSSIBLE DE DÉMARRER LE SERVEUR:");
    console.error("Erreur:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
};

startServer();

module.exports = app;