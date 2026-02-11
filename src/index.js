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

    -- TABLE TEMPLATES EMAIL (NOUVEAU)
    CREATE TABLE email_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      category VARCHAR(50) DEFAULT 'general',
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT,
      variables JSONB DEFAULT '[]'::jsonb,
      is_active BOOLEAN DEFAULT true,
      is_system BOOLEAN DEFAULT false,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- TABLE DES VERSIONS DES TEMPLATES (audit)
    CREATE TABLE template_versions (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES email_templates(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      variables JSONB,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Créer des index
    CREATE INDEX idx_emails_user_id ON emails(user_id);
    CREATE INDEX idx_emails_folder ON emails(folder);
    CREATE INDEX idx_emails_created_at ON emails(created_at DESC);
    CREATE INDEX idx_templates_category ON email_templates(category);
    CREATE INDEX idx_templates_active ON email_templates(is_active);
    CREATE INDEX idx_template_versions_template_id ON template_versions(template_id);
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
  
  // Vérifier et créer la table email_templates si elle n'existe pas
  const checkTemplateTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'email_templates'
    )
  `);
  
  if (!checkTemplateTable.rows[0].exists) {
    console.log("📋 Création de la table 'email_templates'...");
    await dbPool.query(`
      CREATE TABLE email_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        category VARCHAR(50) DEFAULT 'general',
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        text_content TEXT,
        variables JSONB DEFAULT '[]'::jsonb,
        is_active BOOLEAN DEFAULT true,
        is_system BOOLEAN DEFAULT false,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  }
  
  // Vérifier et créer la table template_versions si elle n'existe pas
  const checkVersionTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'template_versions'
    )
  `);
  
  if (!checkVersionTable.rows[0].exists) {
    console.log("📋 Création de la table 'template_versions'...");
    await dbPool.query(`
      CREATE TABLE template_versions (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES email_templates(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        variables JSONB,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
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
  
  // Créer les index pour les templates s'ils n'existent pas
  const checkTemplateIndexes = await dbPool.query(`
    SELECT indexname 
    FROM pg_indexes 
    WHERE tablename = 'email_templates'
  `);
  
  const existingTemplateIndexes = checkTemplateIndexes.rows.map(row => row.indexname);
  
  if (!existingTemplateIndexes.some(idx => idx.includes('idx_templates_category'))) {
    await dbPool.query('CREATE INDEX IF NOT EXISTS idx_templates_category ON email_templates(category)');
  }
  
  if (!existingTemplateIndexes.some(idx => idx.includes('idx_templates_active'))) {
    await dbPool.query('CREATE INDEX IF NOT EXISTS idx_templates_active ON email_templates(is_active)');
  }
  
  console.log("✅ Structure de base de données vérifiée et mise à jour");
};

// ===== CRÉATION DES TEMPLATES PAR DÉFAUT =====
const createDefaultTemplates = async () => {
  try {
    // Vérifier si des templates système existent déjà
    const existingTemplates = await dbPool.query(
      'SELECT COUNT(*) FROM email_templates WHERE is_system = true'
    );
    
    if (parseInt(existingTemplates.rows[0].count) === 0) {
      console.log("📋 Création des templates système par défaut...");
      
      const defaultTemplates = [
        {
          name: 'welcome',
          category: 'onboarding',
          subject: 'Bienvenue chez Youpi.!',
          html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4F46E5;">Bienvenue {{user_name}} !</h1>
            <p>Merci de vous être inscrit à Youpi. Nous sommes ravis de vous accueillir.</p>
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>🚀 Votre compte est prêt !</h3>
              <p>Vous pouvez maintenant :</p>
              <ul>
                <li>📧 Envoyer et recevoir des emails</li>
                <li>📁 Organiser vos emails dans des dossiers</li>
                <li>🔍 Rechercher facilement vos messages</li>
                <li>📱 Utiliser l'application mobile</li>
              </ul>
            </div>
            <p>Si vous avez des questions, n'hésitez pas à répondre à cet email.</p>
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Cordialement,<br>
              L'équipe Youpi.
            </p>
          </div>`,
          text_content: "Bienvenue {{user_name}} ! Merci de vous être inscrit à Youpi...",
          variables: '["user_name", "user_email"]',
          is_system: true
        },
        {
          name: 'password_reset',
          category: 'security',
          subject: 'Réinitialisation de votre mot de passe',
          html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4F46E5;">Réinitialisation du mot de passe</h1>
            <p>Bonjour {{user_name}},</p>
            <p>Vous avez demandé la réinitialisation de votre mot de passe Youpi.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{reset_link}}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Réinitialiser mon mot de passe
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px;">
              Ce lien expirera dans {{expiry_hours}} heures.<br>
              Si vous n'avez pas fait cette demande, ignorez simplement cet email.
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
              Sécurité : Ne partagez jamais ce lien avec qui que ce soit.
            </p>
          </div>`,
          text_content: "Réinitialisation du mot de passe. Cliquez sur : {{reset_link}}",
          variables: '["user_name", "reset_link", "expiry_hours"]',
          is_system: true
        },
        {
          name: 'newsletter',
          category: 'marketing',
          subject: '✨ {{company}} - {{offer_title}}',
          html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4F46E5;">{{offer_title}}</h1>
            <p>Bonjour {{customer_name}},</p>
            <p>{{offer_description}}</p>
            <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3>🎁 Offre spéciale</h3>
              <p><strong>{{offer_details}}</strong></p>
              <p style="font-size: 24px; color: #059669; font-weight: bold;">{{offer_price}}</p>
              <a href="{{cta_link}}" style="display: inline-block; background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">
                {{cta_text}}
              </a>
            </div>
            <p>Cette offre est valable jusqu'au {{valid_until}}.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 14px;">
              {{company}}<br>
              {{company_address}}
            </p>
          </div>`,
          text_content: "{{offer_title}}. Détails : {{offer_description}}",
          variables: '["customer_name", "company", "offer_title", "offer_description", "offer_details", "offer_price", "cta_link", "cta_text", "valid_until", "company_address"]',
          is_system: true
        },
        {
          name: 'meeting_confirmation',
          category: 'professional',
          subject: 'Confirmation de rendez-vous : {{meeting_title}}',
          html_content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4F46E5;">🎯 Rendez-vous confirmé</h1>
            <p>Bonjour {{attendee_name}},</p>
            <p>Votre rendez-vous a été confirmé avec succès.</p>
            <div style="background-color: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0;">
              <h3>📅 Détails du rendez-vous</h3>
              <p><strong>Sujet :</strong> {{meeting_title}}</p>
              <p><strong>Date :</strong> {{meeting_date}}</p>
              <p><strong>Heure :</strong> {{meeting_time}} ({{timezone}})</p>
              <p><strong>Durée :</strong> {{meeting_duration}}</p>
              <p><strong>Lieu/Lien :</strong> {{meeting_location}}</p>
            </div>
            <p><strong>Participants :</strong> {{participants}}</p>
            <p><strong>Ordre du jour :</strong><br>{{agenda}}</p>
            <div style="margin-top: 30px; padding: 15px; background-color: #f3f4f6; border-radius: 6px;">
              <p>🔔 <strong>Rappel :</strong> Vous recevrez un rappel 15 minutes avant le rendez-vous.</p>
            </div>
          </div>`,
          text_content: "Rendez-vous confirmé : {{meeting_title}} le {{meeting_date}} à {{meeting_time}}",
          variables: '["attendee_name", "meeting_title", "meeting_date", "meeting_time", "timezone", "meeting_duration", "meeting_location", "participants", "agenda"]',
          is_system: true
        }
      ];
      
      for (const template of defaultTemplates) {
        await dbPool.query(
          `INSERT INTO email_templates (name, category, subject, html_content, text_content, variables, is_system) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            template.name,
            template.category,
            template.subject,
            template.html_content,
            template.text_content,
            template.variables,
            template.is_system
          ]
        );
      }
      
      console.log(`✅ ${defaultTemplates.length} templates système créés`);
    }
  } catch (error) {
    console.error("❌ Erreur création templates par défaut:", error.message);
  }
};

// ===== FONCTION UTILITAIRE : ENVOI D'EMAIL =====
const sendEmailViaAPI = async (emailData) => {
  const client = getSendGridClient();
  
  const msg = {
    to: emailData.to,
    from: {
      email: process.env.SMTP_SENDER,
      name: emailData.senderName || 'Youpi.'
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
    
    // Récupérer l'email de l'utilisateur
    const userResult = await dbPool.query('SELECT email FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    const userEmail = userResult.rows[0].email;
    
    // Validation réussie
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
    
    // Fonction pour obtenir l'image en base64 (simulation - à adapter selon vos besoins)
    const getBannerImageBase64 = () => {
      // Ici vous pouvez charger une image depuis le système de fichiers
      // ou utiliser une image codée en dur
      try {
        // Exemple: image de bannière par défaut
        return null; // Retourne null pour utiliser le titre par défaut
      } catch (error) {
        console.error("❌ Erreur chargement image:", error);
        return null;
      }
    };
    
    // OBTENIR L'IMAGE EN BASE64
    console.log("🖼️  Chargement de l'image en Base64...");
    const base64Image = getBannerImageBase64();
    
    if (base64Image) {
      console.log(`✅ Image chargée avec succès (${Math.round(base64Image.length / 1024)} KB)`);
    } else {
      console.log("ℹ️  Aucune image disponible, utilisation du titre par défaut");
    }
    
    // Génération du HTML selon le destinataire
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
                        alt="Bannière Youpi." 
                        class="banner">` : 
                  `<h1 class="header-title">Youpi.</h1>`}
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
                    <div class="youpi-badge">Envoyé via Youpi.</div>
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
    console.log(`   Image: ${base64Image ? 'Intégrée (Base64)' : 'Titre par défaut'}`);
    
    const emailData = {
      to: to,
      subject: subject,
      text: message,
      html: htmlContent,
      replyTo: userEmail,
      senderName: 'Youpi.'
    };

    const sendStartTime = Date.now();
    const result = await sendEmailViaAPI(emailData);
    const sendTime = Date.now() - sendStartTime;
    
    console.log(`✅ EMAIL ENVOYÉ AVEC SUCCÈS en ${sendTime}ms`);
    console.log(`   Message ID: ${result.messageId || 'N/A'}`);
    console.log(`   Status Code: ${result.statusCode}`);
    console.log("=".repeat(70) + "\n");
    
    const totalTime = Date.now() - startTime;
    
    // Sauvegarder dans la base de données
    const emailResult = await dbPool.query(
      `INSERT INTO emails (user_id, to_email, subject, content, status, sendgrid_message_id, folder) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, created_at`,
      [user_id, to, subject, message, 'sent', result.messageId, folder]
    );
    
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
      requestId: requestId,
      email_id: emailResult.rows[0].id
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

// ===== ROUTES TEMPLATES EMAIL =====

// 1. Lister tous les templates (protégé)
app.get("/api/templates", authenticateToken, async (req, res) => {
  try {
    const { category, active_only = 'true', include_system = 'true' } = req.query;
    
    let query = `
      SELECT id, name, category, subject, 
             html_content, text_content, variables,
             is_active, is_system, created_at, updated_at
      FROM email_templates
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    // Filtrer par catégorie
    if (category) {
      query += ` AND category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }
    
    // Filtrer par actif seulement
    if (active_only === 'true') {
      query += ` AND is_active = true`;
    }
    
    // Inclure/exclure les templates système
    if (include_system === 'false') {
      query += ` AND is_system = false`;
    }
    
    query += ` ORDER BY category, name`;
    
    const result = await dbPool.query(query, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      templates: result.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération templates:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 2. Récupérer un template spécifique (protégé)
app.get("/api/templates/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dbPool.query(
      `SELECT id, name, category, subject, 
              html_content, text_content, variables,
              is_active, is_system, created_at, updated_at
       FROM email_templates 
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template non trouvé" });
    }
    
    // Récupérer les versions
    const versionsResult = await dbPool.query(
      `SELECT version, subject, created_at 
       FROM template_versions 
       WHERE template_id = $1 
       ORDER BY version DESC`,
      [id]
    );
    
    res.json({
      success: true,
      template: result.rows[0],
      versions: versionsResult.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération template:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 3. Générer un template avec variables (protégé)
app.post("/api/templates/:id/generate", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { variables = {} } = req.body;
    
    // Récupérer le template
    const templateResult = await dbPool.query(
      `SELECT subject, html_content, text_content, variables as available_variables
       FROM email_templates 
       WHERE id = $1 AND is_active = true`,
      [id]
    );
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template non trouvé ou inactif" });
    }
    
    const template = templateResult.rows[0];
    
    // Fonction de remplacement des variables
    const replaceVariables = (content, vars) => {
      if (!content) return content;
      let result = content;
      for (const [key, value] of Object.entries(vars)) {
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(placeholder, value || '');
      }
      return result;
    };
    
    // Générer le contenu avec variables remplacées
    const generated = {
      subject: replaceVariables(template.subject, variables),
      html_content: replaceVariables(template.html_content, variables),
      text_content: replaceVariables(template.text_content, variables),
      variables_used: Object.keys(variables),
      available_variables: template.available_variables || []
    };
    
    res.json({
      success: true,
      generated: generated
    });
    
  } catch (error) {
    console.error("❌ Erreur génération template:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 4. Créer un nouveau template (protégé)
app.post("/api/templates", authenticateToken, async (req, res) => {
  try {
    const { 
      name, 
      category = 'general', 
      subject, 
      html_content, 
      text_content = '', 
      variables = [],
      is_active = true
    } = req.body;
    
    if (!name || !subject || !html_content) {
      return res.status(400).json({ 
        success: false, 
        error: "Nom, sujet et contenu HTML sont requis" 
      });
    }
    
    // Vérifier si le nom existe déjà
    const existingResult = await dbPool.query(
      'SELECT id FROM email_templates WHERE name = $1',
      [name]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: "Un template avec ce nom existe déjà" 
      });
    }
    
    // Créer le template
    const result = await dbPool.query(
      `INSERT INTO email_templates 
       (name, category, subject, html_content, text_content, variables, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, category, subject, created_at`,
      [name, category, subject, html_content, text_content, JSON.stringify(variables), is_active, req.userId]
    );
    
    // Créer la première version
    await dbPool.query(
      `INSERT INTO template_versions 
       (template_id, version, subject, html_content, variables, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [result.rows[0].id, 1, subject, html_content, JSON.stringify(variables), req.userId]
    );
    
    res.status(201).json({
      success: true,
      message: "Template créé avec succès",
      template: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur création template:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 5. Mettre à jour un template (protégé)
app.put("/api/templates/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      category, 
      subject, 
      html_content, 
      text_content, 
      variables, 
      is_active 
    } = req.body;
    
    // Récupérer le template actuel
    const currentResult = await dbPool.query(
      'SELECT version FROM template_versions WHERE template_id = $1 ORDER BY version DESC LIMIT 1',
      [id]
    );
    
    const currentVersion = currentResult.rows.length > 0 ? currentResult.rows[0].version : 0;
    const newVersion = currentVersion + 1;
    
    // Mettre à jour le template
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }
    
    if (category !== undefined) {
      updates.push(`category = $${paramCount}`);
      values.push(category);
      paramCount++;
    }
    
    if (subject !== undefined) {
      updates.push(`subject = $${paramCount}`);
      values.push(subject);
      paramCount++;
    }
    
    if (html_content !== undefined) {
      updates.push(`html_content = $${paramCount}`);
      values.push(html_content);
      paramCount++;
    }
    
    if (text_content !== undefined) {
      updates.push(`text_content = $${paramCount}`);
      values.push(text_content);
      paramCount++;
    }
    
    if (variables !== undefined) {
      updates.push(`variables = $${paramCount}`);
      values.push(JSON.stringify(variables));
      paramCount++;
    }
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      values.push(is_active);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Aucune donnée à modifier" 
      });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    const updateQuery = `UPDATE email_templates SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await dbPool.query(updateQuery, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template non trouvé" });
    }
    
    // Créer une nouvelle version si le contenu a changé
    if (subject !== undefined || html_content !== undefined) {
      const template = result.rows[0];
      await dbPool.query(
        `INSERT INTO template_versions 
         (template_id, version, subject, html_content, variables, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, newVersion, template.subject, template.html_content, template.variables, req.userId]
      );
    }
    
    res.json({
      success: true,
      message: "Template mis à jour",
      template: result.rows[0],
      new_version: newVersion
    });
    
  } catch (error) {
    console.error("❌ Erreur mise à jour template:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 6. Supprimer un template (protégé - seulement si non système)
app.delete("/api/templates/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier que le template n'est pas système
    const checkResult = await dbPool.query(
      'SELECT is_system FROM email_templates WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template non trouvé" });
    }
    
    if (checkResult.rows[0].is_system) {
      return res.status(403).json({ 
        success: false, 
        error: "Impossible de supprimer un template système" 
      });
    }
    
    const result = await dbPool.query(
      'DELETE FROM email_templates WHERE id = $1 RETURNING id, name',
      [id]
    );
    
    res.json({
      success: true,
      message: "Template supprimé",
      template: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur suppression template:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 7. Récupérer les catégories de templates (protégé)
app.get("/api/templates/categories", authenticateToken, async (req, res) => {
  try {
    const result = await dbPool.query(`
      SELECT category, COUNT(*) as template_count
      FROM email_templates
      WHERE is_active = true
      GROUP BY category
      ORDER BY category
    `);
    
    res.json({
      success: true,
      categories: result.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération catégories:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 8. Récupérer un template par son nom (protégé)
app.get("/api/templates/name/:name", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    
    const result = await dbPool.query(
      `SELECT id, name, category, subject, 
              html_content, text_content, variables,
              is_active, is_system, created_at, updated_at
       FROM email_templates 
       WHERE name = $1 AND is_active = true`,
      [name]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template non trouvé" });
    }
    
    res.json({
      success: true,
      template: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération template par nom:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// 9. Dupliquer un template (protégé)
app.post("/api/templates/:id/duplicate", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { new_name } = req.body;
    
    if (!new_name) {
      return res.status(400).json({ 
        success: false, 
        error: "Nouveau nom requis" 
      });
    }
    
    // Vérifier si le nouveau nom existe déjà
    const existingResult = await dbPool.query(
      'SELECT id FROM email_templates WHERE name = $1',
      [new_name]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: "Un template avec ce nom existe déjà" 
      });
    }
    
    // Récupérer le template source
    const sourceResult = await dbPool.query(
      'SELECT * FROM email_templates WHERE id = $1',
      [id]
    );
    
    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template source non trouvé" });
    }
    
    const source = sourceResult.rows[0];
    
    // Dupliquer le template
    const result = await dbPool.query(
      `INSERT INTO email_templates 
       (name, category, subject, html_content, text_content, variables, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, category, subject, created_at`,
      [
        new_name,
        source.category,
        source.subject,
        source.html_content,
        source.text_content,
        source.variables,
        source.is_active,
        req.userId
      ]
    );
    
    res.status(201).json({
      success: true,
      message: "Template dupliqué avec succès",
      template: result.rows[0],
      source_template_id: id
    });
    
  } catch (error) {
    console.error("❌ Erreur duplication template:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====

// Route racine (publique)
app.get("/", (req, res) => {
  res.json({
    message: "Youpi. API avec Base de Données",
    status: "online",
    version: "3.3.0",
    timestamp: new Date().toISOString(),
    features: ["PostgreSQL", "SendGrid API", "Authentification", "Gestion emails", "Dossiers", "Templates"],
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
      templates: [
        "GET /api/templates",
        "GET /api/templates/:id",
        "GET /api/templates/name/:name",
        "GET /api/templates/categories",
        "POST /api/templates",
        "POST /api/templates/:id/generate",
        "POST /api/templates/:id/duplicate",
        "PUT /api/templates/:id",
        "DELETE /api/templates/:id"
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
    await createDefaultTemplates();
    res.json({ 
      success: true, 
      message: "Base de données vérifiée et mise à jour avec succès",
      tables: ["users", "emails", "attachments", "email_templates", "template_versions"]
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
      "GET /api/templates (authentifié)",
      "POST /api/templates (authentifié)",
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
    await createDefaultTemplates(); // 4. Créer templates par défaut
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
      console.log("🚀 YOUPI. API - DÉMARRÉE AVEC SUCCÈS");
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