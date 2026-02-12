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
    fileSize: 25 * 1024 * 1024, // 25MB max
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
      console.log(`⚠️ Image non trouvée: ${imagePath}, utilisation du titre par défaut`);
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

    -- TABLE DES DESIGNS PAR DESTINATAIRE
    CREATE TABLE email_designs (
      id SERIAL PRIMARY KEY,
      destinator_id VARCHAR(50) UNIQUE NOT NULL,
      design_name VARCHAR(100) NOT NULL,
      template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT,
      variables JSONB DEFAULT '[]'::jsonb,
      category VARCHAR(50) DEFAULT 'destinator',
      is_active BOOLEAN DEFAULT true,
      primary_color VARCHAR(20) DEFAULT '#4A5568',
      secondary_color VARCHAR(20) DEFAULT '#718096',
      gradient_start VARCHAR(20) DEFAULT '#4A5568',
      gradient_end VARCHAR(20) DEFAULT '#718096',
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
  
  const checkTemplateTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'email_templates'
    )
  `);
  
  if (!checkTemplateTable.rows[0].exists) {
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
  
  const checkVersionTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'template_versions'
    )
  `);
  
  if (!checkVersionTable.rows[0].exists) {
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
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        text_content TEXT,
        variables JSONB DEFAULT '[]'::jsonb,
        category VARCHAR(50) DEFAULT 'destinator',
        is_active BOOLEAN DEFAULT true,
        primary_color VARCHAR(20) DEFAULT '#4A5568',
        secondary_color VARCHAR(20) DEFAULT '#718096',
        gradient_start VARCHAR(20) DEFAULT '#4A5568',
        gradient_end VARCHAR(20) DEFAULT '#718096',
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
    
    if (!existingDesignColumns.includes('primary_color')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN primary_color VARCHAR(20) DEFAULT \'#4A5568\'');
    }
    if (!existingDesignColumns.includes('secondary_color')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN secondary_color VARCHAR(20) DEFAULT \'#718096\'');
    }
    if (!existingDesignColumns.includes('gradient_start')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN gradient_start VARCHAR(20) DEFAULT \'#4A5568\'');
    }
    if (!existingDesignColumns.includes('gradient_end')) {
      await dbPool.query('ALTER TABLE email_designs ADD COLUMN gradient_end VARCHAR(20) DEFAULT \'#718096\'');
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

// ===== CRÉATION DES TEMPLATES ET DESIGNS PAR DÉFAUT =====
const createDefaultTemplatesAndDesigns = async () => {
  try {
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
              </ul>
            </div>
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
              Ce lien expirera dans {{expiry_hours}} heures.
            </p>
          </div>`,
          text_content: "Réinitialisation du mot de passe. Cliquez sur : {{reset_link}}",
          variables: '["user_name", "reset_link", "expiry_hours"]',
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

    const existingDesigns = await dbPool.query(
      'SELECT COUNT(*) FROM email_designs'
    );
    
    if (parseInt(existingDesigns.rows[0].count) === 0) {
      console.log("📋 Création des designs par destinataire avec couleurs...");
      
      const bannerBase64 = getBannerImageBase64();
      const bannerHtml = bannerBase64 
        ? `<img src="${bannerBase64}" alt="Youpi. Banner" style="width: 100%; max-width: 600px; height: auto; display: block; border-radius: 8px 8px 0 0;">`
        : `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Youpi.</h1>
          </div>`;

      const footerHtml = `
        <div style="background: #1a2634; padding: 30px 20px; text-align: center; border-radius: 0 0 8px 8px;">
          <p style="color: #ffffff; margin: 0 0 15px 0; font-size: 16px; font-weight: 500;">
            📞 Pour la prise de contact avec un service d'opération
          </p>
          <div style="display: inline-block; background: rgba(255,255,255,0.1); padding: 15px 25px; border-radius: 50px; margin-bottom: 20px;">
            <p style="color: #ffffff; margin: 0; font-size: 18px; font-weight: bold;">
              +243 834 171 852  /  +243 856 163 550
            </p>
          </div>
          <p style="color: #9ca3af; margin: 0; font-size: 12px;">
            © ${new Date().getFullYear()} Youpi. Tous droits réservés.<br>
            Service d'envoi d'emails professionnels
          </p>
        </div>
      `;

      const baseStyles = `
        <style>
          body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            line-height: 1.6; 
            margin: 0; 
            padding: 20px; 
            background-color: #f5f5f5;
          }
          .email-wrapper {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          }
          .content-body {
            padding: 35px 30px;
            text-align: justify;
            font-size: 16px;
            color: #2d3748;
          }
          .content-body p {
            margin: 0 0 15px 0;
            text-align: justify;
          }
        </style>
      `;

      const defaultDesigns = [
        {
          destinator_id: 'marketing',
          design_name: 'Design Marketing - Promotionnel',
          primary_color: '#FF6B6B',
          secondary_color: '#FF8E53',
          gradient_start: '#FF6B6B',
          gradient_end: '#FF8E53',
          subject: '{{subject}} - Offre spéciale Youpi.',
          html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
  <style>
    .header-marketing { background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%); }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header-marketing">${bannerHtml}</div>
    <div class="content-body">
      <h2 style="color: #FF6B6B; margin-top: 0; border-bottom: 2px solid #FFE5E5; padding-bottom: 15px;">
        {{subject}}
      </h2>
      <div style="text-align: justify;">
        {{contenu_principal}}
      </div>
    </div>
    ${footerHtml}
  </div>
</body>
</html>`,
          text_content: "{{subject}}\n\n{{contenu_principal}}\n\nPour la prise de contact avec un service d'opération appeler : +243 834 171 852 / +243 856 163 550",
          variables: '["contenu_principal", "subject"]',
          category: 'marketing'
        },
        {
          destinator_id: 'partner',
          design_name: 'Design Partenaire - Professionnel',
          primary_color: '#0F4C81',
          secondary_color: '#2C73D2',
          gradient_start: '#0F4C81',
          gradient_end: '#2C73D2',
          subject: '{{subject}} - Partenariat Youpi.',
          html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
  <style>
    .header-partner { background: linear-gradient(135deg, #0F4C81 0%, #2C73D2 100%); }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header-partner">${bannerHtml}</div>
    <div class="content-body">
      <h2 style="color: #0F4C81; margin-top: 0; border-bottom: 2px solid #E8F0FE; padding-bottom: 15px;">
        {{subject}}
      </h2>
      <div style="text-align: justify;">
        {{contenu_principal}}
      </div>
    </div>
    ${footerHtml}
  </div>
</body>
</html>`,
          text_content: "{{subject}}\n\n{{contenu_principal}}\n\nPour la prise de contact avec un service d'opération appeler : +243 834 171 852 / +243 856 163 550",
          variables: '["contenu_principal", "subject"]',
          category: 'professional'
        },
        {
          destinator_id: 'ad',
          design_name: 'Design Publicité - Événementiel',
          primary_color: '#F9A826',
          secondary_color: '#FFB347',
          gradient_start: '#F9A826',
          gradient_end: '#FFB347',
          subject: '{{subject}} - Ne manquez pas ça !',
          html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
  <style>
    .header-ad { background: linear-gradient(135deg, #F9A826 0%, #FFB347 100%); }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header-ad">${bannerHtml}</div>
    <div class="content-body">
      <h2 style="color: #F9A826; margin-top: 0; border-bottom: 2px solid #FFF3E0; padding-bottom: 15px;">
        {{subject}}
      </h2>
      <div style="text-align: justify;">
        {{contenu_principal}}
      </div>
    </div>
    ${footerHtml}
  </div>
</body>
</html>`,
          text_content: "{{subject}}\n\n{{contenu_principal}}\n\nPour la prise de contact avec un service d'opération appeler : +243 834 171 852 / +243 856 163 550",
          variables: '["contenu_principal", "subject"]',
          category: 'advertising'
        },
        {
          destinator_id: 'other',
          design_name: 'Design Standard - Général',
          primary_color: '#4A5568',
          secondary_color: '#718096',
          gradient_start: '#4A5568',
          gradient_end: '#718096',
          subject: '{{subject}}',
          html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
  <style>
    .header-other { background: linear-gradient(135deg, #4A5568 0%, #718096 100%); }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header-other">${bannerHtml}</div>
    <div class="content-body">
      <h2 style="color: #4A5568; margin-top: 0; border-bottom: 2px solid #EDF2F7; padding-bottom: 15px;">
        {{subject}}
      </h2>
      <div style="text-align: justify;">
        {{contenu_principal}}
      </div>
    </div>
    ${footerHtml}
  </div>
</body>
</html>`,
          text_content: "{{subject}}\n\n{{contenu_principal}}\n\nPour la prise de contact avec un service d'opération appeler : +243 834 171 852 / +243 856 163 550",
          variables: '["contenu_principal", "subject"]',
          category: 'general'
        }
      ];
      
      for (const design of defaultDesigns) {
        await dbPool.query(
          `INSERT INTO email_designs 
           (destinator_id, design_name, subject, html_content, text_content, variables, category, 
            primary_color, secondary_color, gradient_start, gradient_end) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            design.destinator_id,
            design.design_name,
            design.subject,
            design.html_content,
            design.text_content,
            design.variables,
            design.category,
            design.primary_color,
            design.secondary_color,
            design.gradient_start,
            design.gradient_end
          ]
        );
      }
      
      console.log(`✅ ${defaultDesigns.length} designs par destinataire créés avec couleurs personnalisées`);
    }
  } catch (error) {
    console.error("❌ Erreur création templates/designs par défaut:", error.message);
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
const processAttachments = async (files, emailId) => {
  const attachments = [];
  
  for (const file of files) {
    try {
      const fileBuffer = fs.readFileSync(file.path);
      const base64Content = fileBuffer.toString('base64');
      
      const attachment = {
        email_id: emailId,
        filename: file.filename,
        original_filename: file.originalname,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mimetype,
        is_uploaded: true,
        created_at: new Date()
      };
      
      const result = await dbPool.query(
        `INSERT INTO attachments 
         (email_id, filename, original_filename, file_path, file_size, mime_type, is_uploaded) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id`,
        [
          emailId,
          attachment.filename,
          attachment.original_filename,
          attachment.file_path,
          attachment.file_size,
          attachment.mime_type,
          true
        ]
      );
      
      attachment.id = result.rows[0].id;
      
      attachments.push({
        content: base64Content,
        filename: file.originalname,
        type: file.mimetype,
        disposition: 'attachment',
        content_id: attachment.id
      });
      
      console.log(`📎 Pièce jointe sauvegardée: ${file.originalname} (${Math.round(file.size / 1024)} KB)`);
      
    } catch (error) {
      console.error(`❌ Erreur traitement pièce jointe ${file.originalname}:`, error.message);
    }
  }
  
  return attachments;
};

const getAttachmentsByEmailId = async (emailId) => {
  try {
    const result = await dbPool.query(
      `SELECT id, filename, original_filename, file_path, file_size, mime_type, cloud_url, created_at
       FROM attachments 
       WHERE email_id = $1
       ORDER BY created_at ASC`,
      [emailId]
    );
    
    return result.rows;
  } catch (error) {
    console.error(`❌ Erreur récupération pièces jointes pour email ${emailId}:`, error.message);
    return [];
  }
};

const deleteAttachmentsByEmailId = async (emailId) => {
  try {
    const attachments = await dbPool.query(
      'SELECT file_path FROM attachments WHERE email_id = $1',
      [emailId]
    );
    
    for (const att of attachments.rows) {
      if (att.file_path && fs.existsSync(att.file_path)) {
        fs.unlinkSync(att.file_path);
        console.log(`🗑️ Fichier supprimé: ${att.file_path}`);
      }
    }
    
    await dbPool.query('DELETE FROM attachments WHERE email_id = $1', [emailId]);
    
    console.log(`✅ Pièces jointes supprimées pour l'email ${emailId}`);
  } catch (error) {
    console.error(`❌ Erreur suppression pièces jointes pour email ${emailId}:`, error.message);
  }
};

const uploadAttachmentToCloud = async (attachmentId) => {
  try {
    const attachment = await dbPool.query(
      'SELECT * FROM attachments WHERE id = $1',
      [attachmentId]
    );
    
    if (attachment.rows.length === 0) {
      throw new Error('Pièce jointe non trouvée');
    }
    
    const att = attachment.rows[0];
    const cloudUrl = `https://storage.youpi.com/attachments/${att.filename}`;
    
    await dbPool.query(
      'UPDATE attachments SET cloud_url = $1 WHERE id = $2',
      [cloudUrl, attachmentId]
    );
    
    console.log(`☁️ Pièce jointe uploadée vers le cloud: ${cloudUrl}`);
    
    return cloudUrl;
  } catch (error) {
    console.error(`❌ Erreur upload cloud pièce jointe ${attachmentId}:`, error.message);
    throw error;
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

app.delete("/api/auth/delete", authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ success: false, error: "Mot de passe requis pour suppression" });
    }
    
    const userResult = await dbPool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    
    const passwordMatch = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: "Mot de passe incorrect" });
    }
    
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

// ===== ✅ ROUTE PRINCIPALE D'ENVOI D'EMAIL AVEC DESIGN =====
app.post("/api/emails/send", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    
    console.log(`\n📧 ENVOI EMAIL AVEC DESIGN [ID:${requestId}]`);
    
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
      
      // ===== 🔍 RECHERCHE ET APPLICATION DU DESIGN =====
      let designHtml = null;
      let designSubject = null;
      let designId = null;
      let designInfo = null;
      
      try {
        const designResult = await dbPool.query(
          `SELECT id, destinator_id, design_name, subject, html_content, 
                  primary_color, secondary_color, gradient_start, gradient_end
           FROM email_designs 
           WHERE destinator_id = $1 AND is_active = true`,
          [destinator_id]
        );
        
        if (designResult.rows.length > 0) {
          const design = designResult.rows[0];
          designId = design.id;
          designInfo = {
            id: design.id,
            destinator_id: design.destinator_id,
            design_name: design.design_name,
            primary_color: design.primary_color,
            secondary_color: design.secondary_color
          };
          
          let html = design.html_content;
          html = html.replace(/{{contenu_principal}}/g, message || '');
          html = html.replace(/{{subject}}/g, subject || '');
          html = html.replace(/{{sender_email}}/g, userEmail);
          html = html.replace(/{{current_year}}/g, new Date().getFullYear().toString());
          html = html.replace(/{{date}}/g, new Date().toLocaleDateString('fr-FR'));
          html = html.replace(/{{time}}/g, new Date().toLocaleTimeString('fr-FR'));
          html = html.replace(/{{[^}]+}}/g, '');
          
          designHtml = html;
          designSubject = design.subject
            .replace(/{{subject}}/g, subject || '')
            .replace(/{{[^}]+}}/g, '');
          
          console.log(`✅ DESIGN TROUVÉ: ${design.design_name} (${design.primary_color})`);
          console.log(`   ID: ${design.id}, Destinataire: ${design.destinator_id}`);
        } else {
          console.log(`⚠️ Aucun design trouvé pour '${destinator_id}', utilisation du design par défaut`);
          
          const defaultDesign = await dbPool.query(
            `SELECT id, destinator_id, design_name, subject, html_content,
                    primary_color, secondary_color, gradient_start, gradient_end
             FROM email_designs 
             WHERE destinator_id = 'other' AND is_active = true
             LIMIT 1`,
          );
          
          if (defaultDesign.rows.length > 0) {
            const design = defaultDesign.rows[0];
            designId = design.id;
            designInfo = {
              id: design.id,
              destinator_id: design.destinator_id,
              design_name: design.design_name,
              primary_color: design.primary_color,
              secondary_color: design.secondary_color
            };
            
            let html = design.html_content;
            html = html.replace(/{{contenu_principal}}/g, message || '');
            html = html.replace(/{{subject}}/g, subject || '');
            html = html.replace(/{{sender_email}}/g, userEmail);
            html = html.replace(/{{current_year}}/g, new Date().getFullYear().toString());
            html = html.replace(/{{[^}]+}}/g, '');
            
            designHtml = html;
            designSubject = design.subject
              .replace(/{{subject}}/g, subject || '')
              .replace(/{{[^}]+}}/g, '');
          }
        }
      } catch (designError) {
        console.error("❌ Erreur récupération design:", designError.message);
      }
      
      // ===== DESIGN PAR DÉFAUT ABSOLU =====
      if (!designHtml) {
        const bannerBase64 = getBannerImageBase64();
        const bannerHtml = bannerBase64 
          ? `<img src="${bannerBase64}" alt="Youpi. Banner" style="width: 100%; max-width: 600px; height: auto; display: block;">`
          : `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Youpi.</h1>
            </div>`;
        
        designHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f5f5f5; }
    .email-wrapper { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
    .content-body { padding: 30px; text-align: justify; }
    .footer { background: #1a2634; padding: 30px 20px; text-align: center; color: white; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header">${bannerHtml}</div>
    <div class="content-body">
      <h2 style="color: #4F46E5; margin-top: 0;">${subject}</h2>
      <div style="text-align: justify;">${message.replace(/\n/g, '<br>')}</div>
    </div>
    <div class="footer">
      <p style="margin: 0 0 15px 0; font-size: 16px;">📞 Pour la prise de contact avec un service d'opération</p>
      <div style="background: rgba(255,255,255,0.1); padding: 15px 25px; border-radius: 50px; margin-bottom: 20px; display: inline-block;">
        <p style="margin: 0; font-size: 18px; font-weight: bold;">+243 834 171 852 / +243 856 163 550</p>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} Youpi. Tous droits réservés.</p>
    </div>
  </div>
</body>
</html>`;
        designSubject = subject;
      }
      
      const finalSubject = designSubject || subject;
      
      // ===== SAUVEGARDE EN BASE =====
      const emailResult = await dbPool.query(
        `INSERT INTO emails 
         (user_id, to_email, subject, content, status, folder, destinator_id, design_id, has_attachments) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING id, created_at`,
        [user_id, to, finalSubject, message, 'pending', folder, destinator_id, designId, files.length > 0]
      );
      
      const emailId = emailResult.rows[0].id;
      
      let sendGridAttachments = [];
      if (files.length > 0) {
        sendGridAttachments = await processAttachments(files, emailId);
      }
      
      const emailData = {
        to: to,
        subject: finalSubject,
        text: message,
        html: designHtml,
        replyTo: userEmail,
        senderName: 'Youpi.',
        attachments: sendGridAttachments
      };
      
      console.log("⏳ Envoi via SendGrid...");
      console.log(`   Design: ${designInfo?.design_name || 'Défaut'} (${designInfo?.primary_color || '#4A5568'})`);
      console.log(`   Destinator ID: ${destinator_id}`);
      console.log(`   Design ID: ${designId || 'aucun'}`);
      
      const sendStartTime = Date.now();
      const result = await sendEmailViaAPI(emailData);
      const sendTime = Date.now() - sendStartTime;
      
      await dbPool.query(
        `UPDATE emails SET status = 'sent', sendgrid_message_id = $1 WHERE id = $2`,
        [result.messageId, emailId]
      );
      
      console.log(`✅ EMAIL ENVOYÉ AVEC SUCCÈS en ${sendTime}ms`);
      console.log(`   Message ID: ${result.messageId || 'N/A'}`);
      console.log(`   Design appliqué: ${designInfo?.design_name || 'Défaut'}`);
      console.log("=".repeat(70) + "\n");
      
      const totalTime = Date.now() - startTime;
      
      res.json({
        success: true,
        messageId: result.messageId,
        timestamp: new Date().toISOString(),
        details: `Email envoyé avec le design ${designInfo?.design_name || 'par défaut'}`,
        from: process.env.SMTP_SENDER,
        replyTo: userEmail,
        to: to,
        subject: finalSubject,
        processingTime: `${totalTime}ms`,
        requestId: requestId,
        email_id: emailId,
        destinator_id: destinator_id,
        design: designInfo || { 
          id: null, 
          destinator_id: 'other', 
          design_name: 'Design par défaut',
          primary_color: '#4A5568'
        },
        attachments_count: files.length
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

// ===== ROUTES DESIGNS - GESTION COMPLÈTE =====

/**
 * ✅ LISTE TOUS LES DESIGNS DISPONIBLES
 */
app.get("/api/designs/available", authenticateToken, async (req, res) => {
  try {
    const result = await dbPool.query(
      `SELECT id, destinator_id, design_name, category, is_active, 
              primary_color, secondary_color, gradient_start, gradient_end,
              created_at, updated_at,
              (SELECT COUNT(*) FROM emails WHERE destinator_id = d.destinator_id) as usage_count
       FROM email_designs d
       ORDER BY destinator_id`
    );
    
    console.log(`🎨 ${result.rows.length} designs disponibles récupérés`);
    
    res.json({
      success: true,
      count: result.rows.length,
      designs: result.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération designs disponibles:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ✅ TEST D'UN DESIGN SPÉCIFIQUE
 */
app.get("/api/designs/test/:destinator_id", authenticateToken, async (req, res) => {
  try {
    const { destinator_id } = req.params;
    
    console.log(`🔍 Test de design pour: ${destinator_id}`);
    
    const designResult = await dbPool.query(
      `SELECT id, destinator_id, design_name, subject, html_content, 
              category, is_active, primary_color, secondary_color, 
              gradient_start, gradient_end, created_at, updated_at
       FROM email_designs 
       WHERE destinator_id = $1`,
      [destinator_id]
    );
    
    if (designResult.rows.length === 0) {
      const allDesigns = await dbPool.query(
        `SELECT destinator_id, design_name, is_active FROM email_designs ORDER BY destinator_id`
      );
      
      return res.status(404).json({
        success: false,
        error: `Design non trouvé pour destinator_id: ${destinator_id}`,
        available_designs: allDesigns.rows.map(d => d.destinator_id)
      });
    }
    
    const design = designResult.rows[0];
    
    const usageResult = await dbPool.query(
      `SELECT COUNT(*) as usage_count FROM emails WHERE destinator_id = $1`,
      [destinator_id]
    );
    
    console.log(`✅ Design testé: ${design.design_name} (${design.primary_color})`);
    
    res.json({
      success: true,
      message: `Design trouvé pour ${destinator_id}`,
      design: {
        id: design.id,
        destinator_id: design.destinator_id,
        name: design.design_name,
        subject: design.subject,
        category: design.category,
        is_active: design.is_active,
        colors: {
          primary: design.primary_color,
          secondary: design.secondary_color,
          gradient_start: design.gradient_start,
          gradient_end: design.gradient_end
        },
        created_at: design.created_at,
        updated_at: design.updated_at,
        html_preview: design.html_content.substring(0, 300) + '...',
        usage_count: parseInt(usageResult.rows[0].usage_count)
      }
    });
    
  } catch (error) {
    console.error("❌ Erreur test design:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ✅ CRÉATION D'UN NOUVEAU DESIGN AVEC COULEURS
 */
app.post("/api/designs/create", authenticateToken, async (req, res) => {
  try {
    const { 
      destinator_id, 
      design_name, 
      subject, 
      html_content, 
      text_content = '',
      primary_color = '#4A5568',
      secondary_color = '#718096',
      gradient_start = '#4A5568',
      gradient_end = '#718096',
      category = 'destinator',
      variables = []
    } = req.body;
    
    if (!destinator_id || !design_name || !subject || !html_content) {
      return res.status(400).json({ 
        success: false, 
        error: "destinator_id, design_name, subject et html_content sont requis" 
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
       (destinator_id, design_name, subject, html_content, text_content, variables, category,
        primary_color, secondary_color, gradient_start, gradient_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        destinator_id,
        design_name,
        subject,
        html_content,
        text_content,
        JSON.stringify(variables),
        category,
        primary_color,
        secondary_color,
        gradient_start,
        gradient_end
      ]
    );
    
    console.log(`✅ Nouveau design créé: ${design_name} (${destinator_id})`);
    console.log(`   Couleurs: ${primary_color}, ${secondary_color}`);
    
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

/**
 * ✅ MISE À JOUR DES COULEURS D'UN DESIGN
 */
app.patch("/api/designs/:id/colors", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { primary_color, secondary_color, gradient_start, gradient_end } = req.body;
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (primary_color) {
      updates.push(`primary_color = $${paramCount}`);
      values.push(primary_color);
      paramCount++;
    }
    
    if (secondary_color) {
      updates.push(`secondary_color = $${paramCount}`);
      values.push(secondary_color);
      paramCount++;
    }
    
    if (gradient_start) {
      updates.push(`gradient_start = $${paramCount}`);
      values.push(gradient_start);
      paramCount++;
    }
    
    if (gradient_end) {
      updates.push(`gradient_end = $${paramCount}`);
      values.push(gradient_end);
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
    
    console.log(`🎨 Couleurs mises à jour pour le design ${result.rows[0].design_name}`);
    
    res.json({
      success: true,
      message: "Couleurs du design mises à jour",
      design: {
        id: result.rows[0].id,
        destinator_id: result.rows[0].destinator_id,
        design_name: result.rows[0].design_name,
        colors: {
          primary: result.rows[0].primary_color,
          secondary: result.rows[0].secondary_color,
          gradient_start: result.rows[0].gradient_start,
          gradient_end: result.rows[0].gradient_end
        }
      }
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

app.post("/api/emails/draft", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      
      const { to, subject, content, destinator_id } = req.body;
      const user_id = req.userId;
      const files = req.files || [];
      
      const result = await dbPool.query(
        `INSERT INTO emails 
         (user_id, to_email, subject, content, status, folder, destinator_id, has_attachments) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [user_id, to || '', subject || '', content || '', 'draft', 'drafts', destinator_id || null, files.length > 0]
      );
      
      const emailId = result.rows[0].id;
      
      if (files.length > 0) {
        await processAttachments(files, emailId);
      }
      
      res.json({
        success: true,
        message: "Brouillon créé avec succès",
        email: {
          ...result.rows[0],
          attachments_count: files.length
        }
      });
      
    } catch (error) {
      console.error("❌ Erreur création brouillon:", error);
      res.status(500).json({ success: false, error: "Erreur serveur" });
    }
  });
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

app.get("/api/attachments/:id", authenticateToken, async (req, res) => {
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
    
    res.json({
      success: true,
      attachment: {
        id: attachment.id,
        filename: attachment.original_filename,
        size: attachment.file_size,
        mime_type: attachment.mime_type,
        created_at: attachment.created_at,
        url: `/api/attachments/${attachment.id}/download`,
        cloud_url: attachment.cloud_url
      }
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération pièce jointe:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

app.delete("/api/attachments/:id", authenticateToken, async (req, res) => {
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
    
    if (fs.existsSync(attachment.file_path)) {
      fs.unlinkSync(attachment.file_path);
    }
    
    await dbPool.query('DELETE FROM attachments WHERE id = $1', [id]);
    
    const remainingAttachments = await dbPool.query(
      'SELECT COUNT(*) as count FROM attachments WHERE email_id = $1',
      [attachment.email_id]
    );
    
    await dbPool.query(
      'UPDATE emails SET has_attachments = $1 WHERE id = $2',
      [parseInt(remainingAttachments.rows[0].count) > 0, attachment.email_id]
    );
    
    res.json({
      success: true,
      message: "Pièce jointe supprimée avec succès"
    });
    
  } catch (error) {
    console.error("❌ Erreur suppression pièce jointe:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====
app.get("/", (req, res) => {
  res.json({
    message: "Youpi. API avec Base de Données",
    status: "online",
    version: "7.0.0",
    timestamp: new Date().toISOString(),
    features: [
      "PostgreSQL", 
      "SendGrid API", 
      "Authentification", 
      "Designs par destinataire", 
      "Couleurs personnalisées",
      "Image Base64", 
      "Texte justifié",
      "Pièces jointes",
      "Upload/Download fichiers"
    ],
    designs_disponibles: {
      marketing: { couleur: "#FF6B6B", description: "Design promotionnel - Orange/Rouge" },
      partner: { couleur: "#0F4C81", description: "Design professionnel - Bleu foncé" },
      ad: { couleur: "#F9A826", description: "Design événementiel - Jaune/Orange" },
      other: { couleur: "#4A5568", description: "Design standard - Gris" }
    },
    endpoints: {
      auth: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/auth/profile", "DELETE /api/auth/delete"],
      emails: [
        "GET /api/emails",
        "GET /api/emails/:id",
        "POST /api/emails/send (avec design automatique)",
        "POST /api/emails/draft"
      ],
      designs: [
        "GET /api/designs/available",
        "GET /api/designs/test/:destinator_id",
        "POST /api/designs/create",
        "PATCH /api/designs/:id/colors"
      ],
      attachments: [
        "GET /api/attachments/:id",
        "GET /api/attachments/:id/download",
        "DELETE /api/attachments/:id"
      ],
      utils: ["GET /api/health", "GET /api/setup-database"]
    }
  });
});

app.get("/api/health", async (req, res) => {
  try {
    let dbStatus = "❌ non connecté";
    let dbTime = null;
    let tablesInfo = [];
    
    try {
      const dbResult = await dbPool.query('SELECT NOW() as db_time');
      dbStatus = "✅ connecté";
      dbTime = dbResult.rows[0].db_time;
      
      const tablesResult = await dbPool.query(`
        SELECT table_name, 
               (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as columns
        FROM information_schema.tables t
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      tablesInfo = tablesResult.rows;
    } catch (dbError) {
      console.error("❌ Erreur santé DB:", dbError.message);
    }
    
    const bannerImageExists = fs.existsSync(path.join(__dirname, 'assets', 'banner-youpi.png'));
    const uploadsDirExists = fs.existsSync(path.join(__dirname, 'uploads'));
    
    const designsCount = await dbPool.query('SELECT COUNT(*) FROM email_designs');
    
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: dbStatus,
        sendgrid: process.env.SENDGRID_API_KEY ? "✅ configuré" : "❌ manquant",
        smtp_sender: process.env.SMTP_SENDER || "❌ manquant",
        banner_image: bannerImageExists ? "✅ présent" : "⚠️ absent",
        uploads_directory: uploadsDirExists ? "✅ prêt" : "✅ créé au premier upload",
        designs_count: parseInt(designsCount.rows[0].count)
      },
      tables: tablesInfo
    });
  } catch (error) {
    res.status(500).json({ status: "ERROR", error: error.message });
  }
});

app.get("/api/setup-database", async (req, res) => {
  try {
    await createTables();
    await createDefaultTemplatesAndDesigns();
    res.json({ 
      success: true, 
      message: "Base de données vérifiée et mise à jour avec succès",
      designs: ["marketing (rouge/orange)", "partner (bleu)", "ad (jaune/orange)", "other (gris)"]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée: ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

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
    await createDefaultTemplatesAndDesigns();
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
    
    const server = app.listen(PORT, HOST, () => {
      console.log("\n" + "=".repeat(70));
      console.log("🚀 YOUPI. API - DÉMARRÉE AVEC SUCCÈS");
      console.log("=".repeat(70));
      console.log(`🌐 URL: https://system-mail-youpi-backend.onrender.com`);
      console.log(`🔧 Port: ${PORT}`);
      console.log(`🎨 Designs disponibles avec couleurs:`);
      console.log(`   • Marketing: #FF6B6B (Orange/Rouge)`);
      console.log(`   • Partenaire: #0F4C81 (Bleu foncé)`);
      console.log(`   • Publicité: #F9A826 (Jaune/Orange)`);
      console.log(`   • Autre: #4A5568 (Gris)`);
      console.log(`🖼️  Image base64: ${getBannerImageBase64() ? '✅ Chargée' : '⚠️ Non trouvée'}`);
      console.log(`📧 Route /api/emails/send: ✅ Active avec design automatique`);
      console.log(`🎨 Route /api/designs/available: ✅ Active`);
      console.log(`🎨 Route /api/designs/test/:id: ✅ Active`);
      console.log(`🎨 Route /api/designs/create: ✅ Active`);
      console.log(`🎨 Route /api/designs/:id/colors: ✅ Active`);
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