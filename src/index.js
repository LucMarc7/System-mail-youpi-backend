const sgMail = require('@sendgrid/mail');
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const multer = require('multer');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

// ===== CONFIGURATION DE MULTER POUR LES FICHIERS =====
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname) || mime.extension(file.mimetype) || '';
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
}).array('attachments', 10);

// ===== CONFIGURATION DE LA BASE DE DONNÉES =====
let dbPool;
const initializeDatabase = () => {
  console.log("=".repeat(60));
  console.log("🗄️ INITIALISATION BASE DE DONNÉES POSTGRESQL");
  console.log("=".repeat(60));
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERREUR: DATABASE_URL non définie sur Render');
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

// ===== FONCTION POUR CHARGER L'IMAGE EN BASE64 =====
const getBannerImageBase64 = () => {
  try {
    const imagePath = path.join(__dirname, 'assets', 'banner-youpi.png');
    
    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = 'image/png';
      console.log(`🖼️ Image chargée: ${imagePath} (${Math.round(imageBuffer.length / 1024)} KB)`);
      return `data:${mimeType};base64,${base64Image}`;
    } else {
      console.log(`⚠️ Image non trouvée: ${imagePath}, utilisation du fond coloré par défaut`);
      return null;
    }
  } catch (error) {
    console.error("❌ Erreur chargement image:", error.message);
    return null;
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

let sendGridClient = null;
const getSendGridClient = () => {
  if (!sendGridClient) sendGridClient = initializeSendGridClient();
  return sendGridClient;
};

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
    const tablesExist = await dbPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      )
    `);
    
    if (!tablesExist.rows[0].exists) {
      await createNewTables();
      console.log("✅ Tables créées avec succès");
    } else {
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
      destinator_id VARCHAR(50),
      design_id INTEGER,
      has_attachments BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Table pièces jointes
    CREATE TABLE attachments (
      id SERIAL PRIMARY KEY,
      email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      file_url TEXT,
      file_size BIGINT,
      mime_type VARCHAR(255),
      cloud_url TEXT,
      is_uploaded BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Table templates email
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

    -- Table des versions des templates
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

    -- TABLE DES DESIGNS PAR DESTINATAIRE (UNIQUEMENT POUR LES COULEURS)
    CREATE TABLE email_designs (
      id SERIAL PRIMARY KEY,
      destinator_id VARCHAR(50) UNIQUE NOT NULL,
      design_name VARCHAR(100) NOT NULL,
      template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT true,
      header_color VARCHAR(20) DEFAULT '#007AFF',
      footer_color VARCHAR(20) DEFAULT '#2c3e50',
      accent_color VARCHAR(20) DEFAULT '#007AFF',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Créer des index
    CREATE INDEX idx_emails_user_id ON emails(user_id);
    CREATE INDEX idx_emails_folder ON emails(folder);
    CREATE INDEX idx_emails_created_at ON emails(created_at DESC);
    CREATE INDEX idx_emails_destinator_id ON emails(destinator_id);
    CREATE INDEX idx_attachments_email_id ON attachments(email_id);
    CREATE INDEX idx_templates_category ON email_templates(category);
    CREATE INDEX idx_templates_active ON email_templates(is_active);
    CREATE INDEX idx_template_versions_template_id ON template_versions(template_id);
    CREATE INDEX idx_email_designs_destinator_id ON email_designs(destinator_id);
  `;
  
  await dbPool.query(createTablesSQL);
};

const updateExistingTables = async () => {
  const checkColumns = await dbPool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'emails'
  `);
  
  const existingColumns = checkColumns.rows.map(row => row.column_name);
  
  if (!existingColumns.includes('folder')) {
    await dbPool.query('ALTER TABLE emails ADD COLUMN folder VARCHAR(50) DEFAULT \'inbox\'');
  }
  
  if (!existingColumns.includes('updated_at')) {
    await dbPool.query('ALTER TABLE emails ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()');
  }
  
  if (!existingColumns.includes('destinator_id')) {
    await dbPool.query('ALTER TABLE emails ADD COLUMN destinator_id VARCHAR(50)');
  }
  
  if (!existingColumns.includes('design_id')) {
    await dbPool.query('ALTER TABLE emails ADD COLUMN design_id INTEGER');
  }
  
  if (!existingColumns.includes('has_attachments')) {
    await dbPool.query('ALTER TABLE emails ADD COLUMN has_attachments BOOLEAN DEFAULT false');
  }
  
  const checkAttachmentsTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'attachments'
    )
  `);
  
  if (!checkAttachmentsTable.rows[0].exists) {
    await dbPool.query(`
      CREATE TABLE attachments (
        id SERIAL PRIMARY KEY,
        email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_url TEXT,
        file_size BIGINT,
        mime_type VARCHAR(255),
        cloud_url TEXT,
        is_uploaded BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX idx_attachments_email_id ON attachments(email_id);
    `);
  } else {
    const attachColumns = await dbPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attachments'
    `);
    
    const existingAttachColumns = attachColumns.rows.map(row => row.column_name);
    
    if (!existingAttachColumns.includes('cloud_url')) {
      await dbPool.query('ALTER TABLE attachments ADD COLUMN cloud_url TEXT');
    }
    
    if (!existingAttachColumns.includes('is_uploaded')) {
      await dbPool.query('ALTER TABLE attachments ADD COLUMN is_uploaded BOOLEAN DEFAULT false');
    }
  }
  
  const checkDesignsTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'email_designs'
    )
  `);
  
  if (!checkDesignsTable.rows[0].exists) {
    await dbPool.query(`
      CREATE TABLE email_designs (
        id SERIAL PRIMARY KEY,
        destinator_id VARCHAR(50) UNIQUE NOT NULL,
        design_name VARCHAR(100) NOT NULL,
        template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT true,
        header_color VARCHAR(20) DEFAULT '#007AFF',
        footer_color VARCHAR(20) DEFAULT '#2c3e50',
        accent_color VARCHAR(20) DEFAULT '#007AFF',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX idx_email_designs_destinator_id ON email_designs(destinator_id);
    `);
  } else {
    const designColumns = await dbPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'email_designs'
    `);
    
    const existingDesignColumns = designColumns.rows.map(row => row.column_name);
    
    if (!existingDesignColumns.includes('header_color')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN header_color VARCHAR(20) DEFAULT \'#007AFF\'');
    }
    if (!existingDesignColumns.includes('footer_color')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN footer_color VARCHAR(20) DEFAULT \'#2c3e50\'');
    }
    if (!existingDesignColumns.includes('accent_color')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN accent_color VARCHAR(20) DEFAULT \'#007AFF\'');
    }
  }
  
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
  
  if (!existingIndexes.some(idx => idx.includes('idx_emails_destinator_id'))) {
    await dbPool.query('CREATE INDEX IF NOT EXISTS idx_emails_destinator_id ON emails(destinator_id)');
  }
  
  console.log("✅ Structure de base de données vérifiée et mise à jour");
};

// ===== CRÉATION DES DESIGNS PAR DESTINATAIRE (UNIQUEMENT COULEURS) =====
const createDefaultDesigns = async () => {
  try {
    const existingDesigns = await dbPool.query(
      'SELECT COUNT(*) FROM email_designs'
    );
    
    if (parseInt(existingDesigns.rows[0].count) === 0) {
      console.log("🎨 Création des designs par destinataire (couleurs uniquement)...");
      
      const defaultDesigns = [
        {
          destinator_id: 'marketing',
          design_name: 'Marketing - Orange/Rouge',
          header_color: '#FF6B6B',
          footer_color: '#2c3e50',
          accent_color: '#FF6B6B'
        },
        {
          destinator_id: 'partner',
          design_name: 'Partenaire - Bleu foncé',
          header_color: '#0F4C81',
          footer_color: '#2c3e50',
          accent_color: '#0F4C81'
        },
        {
          destinator_id: 'ad',
          design_name: 'Publicité - Jaune/Orange',
          header_color: '#F9A826',
          footer_color: '#2c3e50',
          accent_color: '#F9A826'
        },
        {
          destinator_id: 'other',
          design_name: 'Standard - Bleu',
          header_color: '#007AFF',
          footer_color: '#2c3e50',
          accent_color: '#007AFF'
        }
      ];
      
      for (const design of defaultDesigns) {
        await dbPool.query(
          `INSERT INTO email_designs 
           (destinator_id, design_name, header_color, footer_color, accent_color) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            design.destinator_id,
            design.design_name,
            design.header_color,
            design.footer_color,
            design.accent_color
          ]
        );
      }
      
      console.log(`✅ ${defaultDesigns.length} designs par destinataire créés avec couleurs personnalisées`);
    }
  } catch (error) {
    console.error("❌ Erreur création designs par défaut:", error.message);
  }
};

// ===== FONCTION DE GÉNÉRATION DU HTML UNIFIÉ =====
const generateEmailHTML = (subject, message, userEmail, colors = {}) => {
  const {
    header_color = '#007AFF',
    footer_color = '#2c3e50',
    accent_color = '#007AFF'
  } = colors;

  const bannerBase64 = getBannerImageBase64();
  
  return `<!DOCTYPE html>
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
            background-color: ${header_color};
            padding: 0;
            text-align: center;
        }
        .banner {
            width: 100%;
            max-height: 200px;
            object-fit: cover;
            border-radius: 8px 8px 0 0;
            display: block;
        }
        .header-fallback {
            background-color: ${header_color};
            padding: 30px;
            text-align: center;
            color: white;
            font-size: 24px;
            font-weight: bold;
        }
        .content {
            padding: 30px;
            color: #333333;
        }
        .subject {
            color: ${accent_color};
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
            text-align: justify;
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
            border-left: 4px solid ${accent_color};
            margin-top: 30px;
        }
        .footer {
            background-color: ${footer_color};
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
            color: ${accent_color};
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
            background-color: ${accent_color};
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
        <!-- HEADER AVEC BANNIÈRE -->
        <div class="header">
            ${bannerBase64 
                ? `<img src="${bannerBase64}" 
                       alt="Bannière Youpi Mail" 
                       class="banner"
                       onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'header-fallback\\'>✉️ Youpi Mail</div>';">`
                : `<div class="header-fallback">✉️ Youpi Mail</div>`
            }
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
                <small>Envoyé via Youpi Mail</small>
            </div>
        </div>
    </div>
</body>
</html>`;
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
  
  if (emailData.attachments && emailData.attachments.length > 0) {
    msg.attachments = emailData.attachments.map(att => ({
      content: att.content,
      filename: att.filename,
      type: att.type,
      disposition: 'attachment'
    }));
  }
  
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

// ===== FONCTIONS UTILITAIRES POUR LES PIÈCES JOINTES =====
// ⚠️ IMPORTANT: Ces fonctions doivent être DÉCLARÉES avant d'être utilisées !

/**
 * Traite et sauvegarde les pièces jointes - VERSION CORRIGÉE
 */
const processAttachments = async (files, emailId) => {
  const attachments = [];
  
  for (const file of files) {
    try {
      const fileBuffer = fs.readFileSync(file.path);
      const base64Content = fileBuffer.toString('base64');
      
      // ✅ Insertion avec TOUTES les colonnes
      const result = await dbPool.query(
        `INSERT INTO attachments 
         (email_id, filename, original_filename, file_path, file_size, mime_type, is_uploaded) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id`,
        [
          emailId,
          file.filename,
          file.originalname,
          file.path,
          file.size,
          file.mimetype,
          true
        ]
      );
      
      const attachmentId = result.rows[0].id;
      
      attachments.push({
        content: base64Content,
        filename: file.originalname,
        type: file.mimetype,
        disposition: 'attachment',
        content_id: attachmentId
      });
      
      console.log(`📎 Pièce jointe sauvegardée: ${file.originalname} (${Math.round(file.size / 1024)} KB) - ID: ${attachmentId}`);
      
    } catch (error) {
      console.error(`❌ Erreur traitement pièce jointe ${file.originalname}:`, error.message);
    }
  }
  
  return attachments;
};

/**
 * Récupère les pièces jointes d'un email avec gestion de la compatibilité
 */
const getAttachmentsByEmailId = async (emailId) => {
  try {
    // 1. Vérifier si la table attachments existe
    const tableCheck = await dbPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'attachments'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      return [];
    }
    
    // 2. Vérifier les colonnes disponibles
    const columnsCheck = await dbPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attachments'
    `);
    
    const existingColumns = columnsCheck.rows.map(row => row.column_name);
    
    // 3. Construire la requête dynamique
    let query = 'SELECT id, file_size, mime_type, cloud_url, created_at';
    
    if (existingColumns.includes('original_filename')) {
      query += ', original_filename as filename';
    } else if (existingColumns.includes('filename')) {
      query += ', filename';
    } else {
      query += ', \'fichier_inconnu.pdf\' as filename';
    }
    
    if (existingColumns.includes('file_path')) {
      query += ', file_path';
    }
    
    query += ' FROM attachments WHERE email_id = $1 ORDER BY created_at ASC';
    
    const result = await dbPool.query(query, [emailId]);
    
    // 4. Formater les résultats
    return result.rows.map(att => ({
      id: att.id,
      original_filename: att.filename || 'fichier_inconnu.pdf',
      filename: att.filename || 'fichier_inconnu.pdf',
      file_size: att.file_size || 0,
      mime_type: att.mime_type || 'application/octet-stream',
      url: att.cloud_url || `/api/attachments/${att.id}/download`,
      created_at: att.created_at
    }));
    
  } catch (error) {
    console.error(`❌ Erreur récupération pièces jointes pour email ${emailId}:`, error.message);
    return [];
  }
};

/**
 * Mise à jour de la table attachments pour ajouter les colonnes manquantes
 */
const updateAttachmentsTable = async () => {
  try {
    const tableCheck = await dbPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'attachments'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      const columnsCheck = await dbPool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'attachments'
      `);
      
      const existingColumns = columnsCheck.rows.map(row => row.column_name);
      
      if (!existingColumns.includes('original_filename')) {
        console.log("📋 Ajout de la colonne 'original_filename'...");
        await dbPool.query(`
          ALTER TABLE attachments 
          ADD COLUMN original_filename VARCHAR(255);
        `);
        
        await dbPool.query(`
          UPDATE attachments 
          SET original_filename = filename 
          WHERE original_filename IS NULL AND filename IS NOT NULL;
        `);
      }
      
      if (!existingColumns.includes('file_size')) {
        console.log("📋 Ajout de la colonne 'file_size'...");
        await dbPool.query(`
          ALTER TABLE attachments 
          ADD COLUMN file_size BIGINT DEFAULT 0;
        `);
      }
      
      if (!existingColumns.includes('mime_type')) {
        console.log("📋 Ajout de la colonne 'mime_type'...");
        await dbPool.query(`
          ALTER TABLE attachments 
          ADD COLUMN mime_type VARCHAR(255) DEFAULT 'application/octet-stream';
        `);
      }
      
      console.log("✅ Table 'attachments' mise à jour");
    }
  } catch (error) {
    console.error("❌ Erreur mise à jour table attachments:", error.message);
  }
};

/**
 * Initialisation complète des tables
 */
const initializeDatabaseTables = async () => {
  try {
    await createTables();
    await createDefaultDesigns();
    await updateAttachmentsTable();
    console.log("✅ Toutes les tables sont à jour");
  } catch (error) {
    console.error("❌ Erreur initialisation tables:", error.message);
  }
};

// ===== MIDDLEWARES =====
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ===== MIDDLEWARE D'AUTHENTIFICATION =====
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      if (req.method === 'GET' && (
        req.path === '/' || 
        req.path.startsWith('/api/health') ||
        req.path.startsWith('/api/setup-database')
      )) {
        return next();
      }
      return res.status(401).json({ success: false, error: 'Token manquant' });
    }
    
    const parts = token.split('_');
    if (parts.length !== 3 || parts[0] !== 'user') {
      return res.status(401).json({ success: false, error: 'Token invalide' });
    }
    
    const userId = parseInt(parts[1]);
    if (isNaN(userId)) {
      return res.status(401).json({ success: false, error: 'Token invalide' });
    }
    
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
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    console.log("📝 Inscription:", { email, name: name || email.split('@')[0] });
    
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
    
    const existingUser = await dbPool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, error: "Un compte existe déjà avec cet email" });
    }
    
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    const result = await dbPool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, password_hash, name || email.split('@')[0]]
    );
    
    const user = result.rows[0];
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

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log("🔐 Connexion:", { email });
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email et mot de passe requis" });
    }
    
    const result = await dbPool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect" });
    }
    
    const user = result.rows[0];
    
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect" });
    }
    
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

/**
 * ROUTE DE MAINTENANCE - Répare les tables et les données
 */
app.post("/api/maintenance/fix-attachments", authenticateToken, async (req, res) => {
  try {
    const userResult = await dbPool.query('SELECT id FROM users WHERE id = $1', [req.userId]);
    if (userResult.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Accès non autorisé" });
    }

    const results = [];
    
    const columnsCheck = await dbPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attachments'
    `);
    
    const existingColumns = columnsCheck.rows.map(row => row.column_name);
    
    if (!existingColumns.includes('original_filename')) {
      await dbPool.query(`
        ALTER TABLE attachments 
        ADD COLUMN original_filename VARCHAR(255);
      `);
      results.push("✅ Colonne 'original_filename' ajoutée");
    }
    
    const updateResult = await dbPool.query(`
      UPDATE attachments 
      SET original_filename = filename 
      WHERE original_filename IS NULL AND filename IS NOT NULL;
    `);
    results.push(`✅ ${updateResult.rowCount} enregistrements mis à jour`);
    
    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_attachments_email_id 
      ON attachments(email_id);
    `);
    results.push("✅ Index vérifié");
    
    res.json({
      success: true,
      message: "Maintenance terminée",
      results
    });
    
  } catch (error) {
    console.error("❌ Erreur maintenance:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== ROUTE PRINCIPALE D'ENVOI D'EMAIL =====
app.post("/api/emails/send", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    
    console.log(`\n📧 ENVOI EMAIL [ID:${requestId}]`);
    
    if (err) {
      console.error("❌ Erreur upload:", err);
      return res.status(400).json({
        success: false,
        error: "Erreur lors de l'upload des fichiers",
        details: err.message
      });
    }
    
    try {
      const { to, subject, message, folder = 'sent', destinator_id = 'other' } = req.body;
      const user_id = req.userId;
      const files = req.files || [];
      
      if (!to || !subject || !message) {
        return res.status(400).json({
          success: false,
          error: "Données manquantes: to, subject et message sont requis"
        });
      }
      
      console.log(`📤 Envoi email de user ${user_id} à ${to} [design: ${destinator_id}]`);
      console.log(`📎 ${files.length} pièce(s) jointe(s) reçue(s)`);
      
      const userResult = await dbPool.query('SELECT email FROM users WHERE id = $1', [user_id]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
      }
      const userEmail = userResult.rows[0].email;
      
      // ===== RECHERCHE DES COULEURS DU DESIGN =====
      let designColors = {
        header_color: '#007AFF',
        footer_color: '#2c3e50',
        accent_color: '#007AFF'
      };
      let designId = null;
      let designName = 'Standard - Bleu';
      
      try {
        const designResult = await dbPool.query(
          `SELECT id, design_name, header_color, footer_color, accent_color
           FROM email_designs 
           WHERE destinator_id = $1 AND is_active = true`,
          [destinator_id]
        );
        
        if (designResult.rows.length > 0) {
          const design = designResult.rows[0];
          designId = design.id;
          designName = design.design_name;
          designColors = {
            header_color: design.header_color,
            footer_color: design.footer_color,
            accent_color: design.accent_color
          };
          console.log(`🎨 Design trouvé: ${design.design_name} (${design.header_color})`);
        } else {
          console.log(`ℹ️ Aucun design trouvé pour '${destinator_id}', utilisation des couleurs par défaut`);
        }
      } catch (designError) {
        console.error("⚠️ Erreur récupération design:", designError.message);
      }
      
      // ===== GÉNÉRATION DU HTML UNIFIÉ =====
      const finalHTML = generateEmailHTML(subject, message, userEmail, designColors);
      
      // ===== SAUVEGARDE EN BASE =====
      const emailResult = await dbPool.query(
        `INSERT INTO emails 
         (user_id, to_email, subject, content, status, folder, destinator_id, design_id, has_attachments) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING id, created_at`,
        [user_id, to, subject, message, 'pending', folder, destinator_id, designId, files.length > 0]
      );
      
      const emailId = emailResult.rows[0].id;
      
      // ===== TRAITEMENT DES PIÈCES JOINTES =====
      let sendGridAttachments = [];
      if (files.length > 0) {
        sendGridAttachments = await processAttachments(files, emailId);
        console.log(`✅ ${sendGridAttachments.length} pièce(s) jointe(s) préparée(s) pour SendGrid`);
      }
      
      // ===== PRÉPARATION ET ENVOI =====
      const emailData = {
        to: to,
        subject: subject,
        text: message,
        html: finalHTML,
        replyTo: userEmail,
        senderName: 'Youpi Mail',
        attachments: sendGridAttachments
      };
      
      console.log("⏳ Envoi via SendGrid...");
      console.log(`🎨 Design: ${designName}`);
      console.log(`🖼️ Bannière: ${getBannerImageBase64() ? 'Intégrée' : 'Fond coloré'}`);
      console.log(`📎 Attachments SendGrid: ${sendGridAttachments.length}`);
      
      const sendStartTime = Date.now();
      const result = await sendEmailViaAPI(emailData);
      const sendTime = Date.now() - sendStartTime;
      
      await dbPool.query(
        `UPDATE emails SET status = 'sent', sendgrid_message_id = $1 WHERE id = $2`,
        [result.messageId, emailId]
      );
      
      console.log(`✅ EMAIL ENVOYÉ AVEC SUCCÈS en ${sendTime}ms`);
      console.log(`📧 Message ID: ${result.messageId || 'N/A'}`);
      console.log(`📎 Pièces jointes envoyées: ${sendGridAttachments.length}`);
      console.log("=".repeat(70) + "\n");
      
      const totalTime = Date.now() - startTime;
      
      res.json({
        success: true,
        messageId: result.messageId,
        timestamp: new Date().toISOString(),
        details: `Email envoyé avec le design ${designName}`,
        from: process.env.SMTP_SENDER,
        replyTo: userEmail,
        to: to,
        subject: subject,
        processingTime: `${totalTime}ms`,
        requestId: requestId,
        email_id: emailId,
        destinator_id: destinator_id,
        design: {
          id: designId,
          name: designName,
          colors: designColors
        },
        attachments_count: files.length,
        attachments_sent: sendGridAttachments.length
      });
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      
      console.error(`💥 Erreur envoi email [${requestId}]:`, error.message);
      
      if (req.userId && req.body) {
        try {
          await dbPool.query(
            `INSERT INTO emails 
             (user_id, to_email, subject, content, status, error_detail, folder, destinator_id, has_attachments) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              req.userId, 
              req.body.to, 
              req.body.subject, 
              req.body.message, 
              'failed', 
              error.message, 
              'failed', 
              req.body.destinator_id || 'other',
              req.files?.length > 0 || false
            ]
          );
        } catch (dbError) {
          console.error("❌ Erreur sauvegarde email échoué:", dbError);
        }
      }
      
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
              console.log(`🗑️ Fichier temporaire supprimé: ${file.path}`);
            }
          } catch (cleanupError) {
            console.error("❌ Erreur nettoyage fichier:", cleanupError);
          }
        }
      }
      
      res.status(500).json({
        success: false,
        error: "Échec de l'envoi de l'email",
        details: error.message,
        processingTime: `${totalTime}ms`,
        requestId: requestId
      });
    }
  });
});

// ===== ROUTES DESIGNS =====
app.get("/api/designs", authenticateToken, async (req, res) => {
  try {
    const result = await dbPool.query(
      `SELECT id, destinator_id, design_name, is_active, 
              header_color, footer_color, accent_color,
              created_at, updated_at,
              (SELECT COUNT(*) FROM emails WHERE destinator_id = d.destinator_id) as usage_count
       FROM email_designs d
       ORDER BY destinator_id`
    );
    
    console.log(`🎨 ${result.rows.length} designs disponibles`);
    
    res.json({
      success: true,
      count: result.rows.length,
      designs: result.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération designs:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/designs/test/:destinator_id", authenticateToken, async (req, res) => {
  try {
    const { destinator_id } = req.params;
    
    const designResult = await dbPool.query(
      `SELECT id, destinator_id, design_name, is_active, 
              header_color, footer_color, accent_color
       FROM email_designs 
       WHERE destinator_id = $1`,
      [destinator_id]
    );
    
    if (designResult.rows.length === 0) {
      const allDesigns = await dbPool.query(
        `SELECT destinator_id, design_name FROM email_designs ORDER BY destinator_id`
      );
      
      return res.status(404).json({
        success: false,
        error: `Design non trouvé pour destinator_id: ${destinator_id}`,
        available_designs: allDesigns.rows.map(d => d.destinator_id)
      });
    }
    
    const design = designResult.rows[0];
    
    res.json({
      success: true,
      design: {
        id: design.id,
        destinator_id: design.destinator_id,
        name: design.design_name,
        is_active: design.is_active,
        colors: {
          header: design.header_color,
          footer: design.footer_color,
          accent: design.accent_color
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Erreur test design:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/designs/create", authenticateToken, async (req, res) => {
  try {
    const { 
      destinator_id, 
      design_name, 
      header_color = '#007AFF',
      footer_color = '#2c3e50',
      accent_color = '#007AFF'
    } = req.body;
    
    if (!destinator_id || !design_name) {
      return res.status(400).json({ 
        success: false, 
        error: "destinator_id et design_name sont requis" 
      });
    }
    
    const existingResult = await dbPool.query(
      'SELECT id FROM email_designs WHERE destinator_id = $1',
      [destinator_id]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: "Un design avec cet identifiant existe déjà" 
      });
    }
    
    const result = await dbPool.query(
      `INSERT INTO email_designs 
       (destinator_id, design_name, header_color, footer_color, accent_color)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        destinator_id,
        design_name,
        header_color,
        footer_color,
        accent_color
      ]
    );
    
    console.log(`✅ Nouveau design créé: ${design_name} (${destinator_id})`);
    
    res.status(201).json({
      success: true,
      message: "Design créé avec succès",
      design: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur création design:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch("/api/designs/:id/colors", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { header_color, footer_color, accent_color } = req.body;
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (header_color) {
      updates.push(`header_color = $${paramCount}`);
      values.push(header_color);
      paramCount++;
    }
    
    if (footer_color) {
      updates.push(`footer_color = $${paramCount}`);
      values.push(footer_color);
      paramCount++;
    }
    
    if (accent_color) {
      updates.push(`accent_color = $${paramCount}`);
      values.push(accent_color);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Aucune couleur à mettre à jour" 
      });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    const query = `UPDATE email_designs SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await dbPool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Design non trouvé" });
    }
    
    console.log(`🎨 Couleurs mises à jour pour ${result.rows[0].design_name}`);
    
    res.json({
      success: true,
      message: "Couleurs du design mises à jour",
      design: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur mise à jour couleurs:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== AUTRES ROUTES EMAIL =====
app.get("/api/emails", authenticateToken, async (req, res) => {
  try {
    const user_id = req.userId;
    const { page = 1, limit = 50, folder, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT * FROM emails WHERE user_id = $1';
    const params = [user_id];
    let paramCount = 2;
    
    if (folder && folder !== 'all' && folder !== 'undefined') {
      query += ` AND folder = $${paramCount}`;
      params.push(folder);
      paramCount++;
    }
    
    if (status && status !== 'undefined') {
      query += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    if (search && search !== 'undefined') {
      query += ` AND (subject ILIKE $${paramCount} OR content ILIKE $${paramCount} OR to_email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await dbPool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    
    query += ' ORDER BY created_at DESC LIMIT $' + paramCount + ' OFFSET $' + (paramCount + 1);
    params.push(parseInt(limit), offset);
    
    const result = await dbPool.query(query, params);
    
    const emailsWithAttachments = await Promise.all(
      result.rows.map(async (email) => {
        const attachments = await getAttachmentsByEmailId(email.id);
        return {
          id: email.id,
          to: email.to_email,
          subject: email.subject,
          content: email.content,
          status: email.status,
          folder: email.folder || 'inbox',
          destinator_id: email.destinator_id,
          design_id: email.design_id,
          has_attachments: email.has_attachments || attachments.length > 0,
          attachments: attachments.map(att => ({
            id: att.id,
            filename: att.original_filename,
            size: att.file_size,
            mime_type: att.mime_type,
            url: att.cloud_url || `/api/attachments/${att.id}/download`,
            created_at: att.created_at
          })),
          createdAt: email.created_at,
          updatedAt: email.updated_at || email.created_at,
          errorDetail: email.error_detail,
          sendgrid_message_id: email.sendgrid_message_id
        };
      })
    );
    
    res.json({
      success: true,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      emails: emailsWithAttachments
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération emails:", error);
    res.status(500).json({ 
      success: false, 
      error: "Erreur serveur lors de la récupération des emails",
      details: error.message 
    });
  }
});

app.get("/api/emails/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.userId;
    
    const result = await dbPool.query(
      'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Email non trouvé" });
    }
    
    const email = result.rows[0];
    const attachments = await getAttachmentsByEmailId(email.id);
    
    res.json({
      success: true,
      email: {
        id: email.id,
        to: email.to_email,
        subject: email.subject,
        content: email.content,
        status: email.status,
        folder: email.folder || 'inbox',
        destinator_id: email.destinator_id,
        design_id: email.design_id,
        has_attachments: email.has_attachments || attachments.length > 0,
        attachments: attachments.map(att => ({
          id: att.id,
          filename: att.original_filename,
          size: att.file_size,
          mime_type: att.mime_type,
          url: att.cloud_url || `/api/attachments/${att.id}/download`,
          created_at: att.created_at
        })),
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

// ===== ROUTES PIÈCES JOINTES =====
app.get("/api/attachments/:id/download", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dbPool.query(
      `SELECT a.*, e.user_id 
       FROM attachments a
       JOIN emails e ON a.email_id = e.id
       WHERE a.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Pièce jointe non trouvée" });
    }
    
    const attachment = result.rows[0];
    
    if (attachment.user_id !== req.userId) {
      return res.status(403).json({ success: false, error: "Accès non autorisé" });
    }
    
    if (!fs.existsSync(attachment.file_path)) {
      return res.status(404).json({ success: false, error: "Fichier non trouvé" });
    }
    
    res.download(attachment.file_path, attachment.original_filename);
    
  } catch (error) {
    console.error("❌ Erreur téléchargement pièce jointe:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====
app.get("/", (req, res) => {
  res.json({
    message: "Youpi. API - Design Unifié",
    status: "online",
    version: "8.1.0",
    timestamp: new Date().toISOString(),
    features: [
      "PostgreSQL",
      "SendGrid API",
      "Authentification",
      "Design unifié - Même structure HTML pour tous",
      "Couleurs personnalisables par destinataire",
      "Image bannière en Base64",
      "Texte justifié",
      "Pièces jointes avec SendGrid"
    ],
    designs_disponibles: {
      marketing: { header: "#FF6B6B", accent: "#FF6B6B", description: "Orange/Rouge" },
      partner: { header: "#0F4C81", accent: "#0F4C81", description: "Bleu foncé" },
      ad: { header: "#F9A826", accent: "#F9A826", description: "Jaune/Orange" },
      other: { header: "#007AFF", accent: "#007AFF", description: "Bleu standard" }
    }
  });
});

app.get("/api/health", async (req, res) => {
  try {
    let dbStatus = "❌ non connecté";
    let dbTime = null;
    
    try {
      const dbResult = await dbPool.query('SELECT NOW() as db_time');
      dbStatus = "✅ connecté";
      dbTime = dbResult.rows[0].db_time;
    } catch (dbError) {
      console.error("❌ Erreur santé DB:", dbError.message);
    }
    
    const bannerImageExists = fs.existsSync(path.join(__dirname, 'assets', 'banner-youpi.png'));
    const uploadsDirExists = fs.existsSync(path.join(__dirname, 'uploads'));
    
    const designsCount = await dbPool.query('SELECT COUNT(*) FROM email_designs');
    const attachmentsCount = await dbPool.query('SELECT COUNT(*) FROM attachments');
    
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: dbStatus,
        sendgrid: process.env.SENDGRID_API_KEY ? "✅ configuré" : "❌ manquant",
        smtp_sender: process.env.SMTP_SENDER || "❌ manquant",
        banner_image: bannerImageExists ? "✅ présent" : "⚠️ absent (fond coloré)",
        uploads_directory: uploadsDirExists ? "✅ prêt" : "✅ créé au premier upload",
        designs_total: parseInt(designsCount.rows[0].count),
        attachments_total: parseInt(attachmentsCount.rows[0].count)
      }
    });
  } catch (error) {
    res.status(500).json({ status: "ERROR", error: error.message });
  }
});

app.get("/api/setup-database", async (req, res) => {
  try {
    await createTables();
    await createDefaultDesigns();
    await updateAttachmentsTable();
    res.json({ 
      success: true, 
      message: "Base de données vérifiée et mise à jour avec succès",
      designs: ["marketing (orange)", "partner (bleu foncé)", "ad (jaune)", "other (bleu)"]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Gestion 404
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
    message: process.env.NODE_ENV === 'production' ? undefined : err.message,
    timestamp: new Date().toISOString()
  });
});

// ===== DÉMARRAGE =====
const initializeServices = async () => {
  try {
    console.log("🔄 Initialisation des services...");
    initializeDatabase();
    getSendGridClient();
    
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      throw new Error("Impossible de se connecter à la base de données");
    }
    
    await createTables();
    await createDefaultDesigns();
    await updateAttachmentsTable();
    console.log("🚀 Tous les services sont prêts !");
  } catch (error) {
    console.error("💥 Échec initialisation:", error);
    process.exit(1);
  }
};

process.on('uncaughtException', (error) => {
  console.error("💥 ERREUR NON CAPTURÉE:", error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error("💥 PROMESSE NON GÉRÉE:", reason);
  process.exit(1);
});

const startServer = async () => {
  try {
    await initializeServices();
    
    const server = app.listen(PORT, HOST, async () => {  // ⚠️ AJOUTEZ 'async' ICI
      console.log("\n" + "=".repeat(70));
      console.log("🚀 YOUPI. API - DESIGN UNIFIÉ");
      console.log("=".repeat(70));
      console.log(`🌐 URL: https://system-mail-youpi-backend.onrender.com`);
      console.log(`🔧 Port: ${PORT}`);
      console.log(`\n🎨 Designs disponibles:`);
      console.log(`   • Marketing: En-tête #FF6B6B`);
      console.log(`   • Partenaire: En-tête #0F4C81`);
      console.log(`   • Publicité: En-tête #F9A826`);
      console.log(`   • Autre: En-tête #007AFF`);
      console.log(`\n🖼️  Bannière: ${getBannerImageBase64() ? '✅ Image chargée' : '⚠️ Fond coloré'}`);
      
      try {
        const attachmentsResult = await dbPool.query('SELECT COUNT(*) FROM attachments');
        const attachmentsCount = attachmentsResult.rows[0].count;
        console.log(`📎 Gestion pièces jointes: ✅ Active (${attachmentsCount} fichiers)`);
      } catch (error) {
        console.log(`📎 Gestion pièces jointes: ✅ Active (0 fichiers - table non créée)`);
      }
      
      console.log("=".repeat(70));
    });
    
    
    const shutdown = (signal) => {
      console.log(`\n🛑 Signal ${signal} reçu - Arrêt du serveur...`);
      server.close(() => {
        console.log('✅ Serveur arrêté');
        if (dbPool) {
          dbPool.end(() => {
            console.log('✅ Pool PostgreSQL fermé');
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
    console.error("💥 IMPOSSIBLE DE DÉMARRER LE SERVEUR:", error.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;