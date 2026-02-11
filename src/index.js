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

// ===== FONCTION POUR CHARGER L'IMAGE EN BASE64 =====
const getBannerImageBase64 = () => {
  try {
    const imagePath = path.join(__dirname, 'assets', 'youpi-banner.png');
    
    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      console.log(`✅ Image chargée avec succès (${Math.round(imageBuffer.length / 1024)} KB)`);
      return base64Image;
    } else {
      console.log("ℹ️ Fichier image non trouvé dans /assets/youpi-banner.png, utilisation du titre par défaut");
      return null;
    }
  } catch (error) {
    console.error("❌ Erreur chargement image:", error.message);
    return null;
  }
};

// ===== DESIGN EMAIL UNIFIÉ POUR TOUS LES DESTINATAIRES =====
const getUnifiedEmailDesign = (message, subject, userEmail, destinatorId = 'other') => {
  const base64Image = getBannerImageBase64();
  const currentYear = new Date().getFullYear();
  
  // Styles selon le type de destinataire
  let headerGradient, accentColor, fontFamily;
  
  switch(destinatorId) {
    case 'marketing':
      headerGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      accentColor = '#667eea';
      fontFamily = "'Arial', 'Helvetica', sans-serif";
      break;
    case 'partner':
      headerGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      accentColor = '#10b981';
      fontFamily = "'Georgia', 'Times New Roman', serif";
      break;
    case 'ad':
      headerGradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      accentColor = '#f59e0b';
      fontFamily = "'Helvetica', 'Arial', sans-serif";
      break;
    default:
      headerGradient = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
      accentColor = '#6b7280';
      fontFamily = "'Arial', 'Helvetica', sans-serif";
  }

  return `
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${subject}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: ${fontFamily};
        background-color: #f3f4f6;
        margin: 0;
        padding: 20px;
        line-height: 1.6;
      }
      
      .email-wrapper {
        max-width: 650px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
      }
      
      /* HEADER avec image Base64 */
      .header {
        width: 100%;
        background: ${headerGradient};
        text-align: center;
      }
      
      .banner-img {
        width: 100%;
        max-height: 220px;
        object-fit: cover;
        display: block;
        border-bottom: 4px solid rgba(255, 255, 255, 0.2);
      }
      
      .header-title {
        color: white;
        font-size: 28px;
        font-weight: 700;
        padding: 30px 20px;
        margin: 0;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
        letter-spacing: 1px;
      }
      
      /* BODY avec texte justifié */
      .content {
        padding: 45px 40px;
        background: white;
      }
      
      .subject-line {
        color: ${accentColor};
        font-size: 22px;
        font-weight: 600;
        margin-bottom: 25px;
        padding-bottom: 15px;
        border-bottom: 2px solid ${accentColor}30;
        text-transform: capitalize;
      }
      
      .message-body {
        font-size: 16px;
        color: #2d3748;
        line-height: 1.8;
        text-align: justify;
        margin-bottom: 30px;
        word-wrap: break-word;
      }
      
      .message-body p {
        margin-bottom: 15px;
        text-align: justify;
      }
      
      .message-body a {
        color: ${accentColor};
        text-decoration: none;
        font-weight: 600;
      }
      
      .message-body a:hover {
        text-decoration: underline;
      }
      
      .sender-info {
        background-color: #f8fafc;
        padding: 20px 25px;
        border-radius: 12px;
        border-left: 4px solid ${accentColor};
        margin-top: 30px;
        font-size: 14px;
        color: #4a5568;
      }
      
      .sender-info strong {
        color: ${accentColor};
      }
      
      .youpi-badge {
        display: inline-block;
        background-color: ${accentColor}10;
        color: ${accentColor};
        padding: 6px 16px;
        border-radius: 30px;
        font-size: 12px;
        font-weight: 600;
        margin-top: 12px;
        border: 1px solid ${accentColor}30;
      }
      
      /* FOOTER avec numéros de téléphone */
      .footer {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: white;
        padding: 35px 30px;
        text-align: center;
      }
      
      .contact-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 20px;
        color: #e2e8f0;
        text-transform: uppercase;
        letter-spacing: 2px;
      }
      
      .phone-numbers {
        font-size: 20px;
        font-weight: 700;
        color: #fbbf24;
        margin: 20px 0;
        line-height: 1.8;
        background: rgba(0, 0, 0, 0.2);
        padding: 15px;
        border-radius: 50px;
        display: inline-block;
      }
      
      .phone-numbers span {
        display: inline-block;
        margin: 0 10px;
      }
      
      .contact-message {
        font-size: 14px;
        color: #94a3b8;
        margin: 15px 0 5px;
        font-style: italic;
      }
      
      .company-name {
        font-size: 18px;
        font-weight: 700;
        margin: 25px 0 10px;
        color: white;
      }
      
      .copyright {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 25px;
        padding-top: 20px;
        border-top: 1px solid #334155;
      }
      
      @media (max-width: 600px) {
        .content {
          padding: 30px 20px;
        }
        .subject-line {
          font-size: 20px;
        }
        .message-body {
          font-size: 15px;
        }
        .phone-numbers {
          font-size: 18px;
          padding: 12px;
        }
      }
    </style>
  </head>
  <body>
    <div class="email-wrapper">
      
      <!-- HEADER avec image Base64 -->
      <div class="header">
        ${base64Image 
          ? `<img src="${base64Image}" alt="Youpi. - Solution Email Professionnelle" class="banner-img">`
          : `<h1 class="header-title">📧 Youpi.</h1>`
        }
      </div>
      
      <!-- BODY avec contenu justifié -->
      <div class="content">
        <h2 class="subject-line">${subject}</h2>
        
        <div class="message-body">
          ${message.replace(/\n/g, '<br>').split('<br>').map(para => 
            para.trim() ? `<p>${para.trim()}</p>` : ''
          ).join('')}
        </div>
        
        <div class="sender-info">
          <p style="margin: 0;">
            <strong>✉️ Expéditeur :</strong> ${userEmail}<br>
            <span style="color: #64748b; font-size: 13px;">Cet email a été envoyé depuis l'application Youpi.</span>
          </p>
          <div class="youpi-badge">
            🚀 Service d'envoi professionnel
          </div>
        </div>
      </div>
      
      <!-- FOOTER avec numéros de téléphone -->
      <div class="footer">
        <div class="contact-title">📞 SERVICE OPÉRATIONS</div>
        
        <div class="contact-message">
          Pour toute prise de contact avec un service d'opération, appelez :
        </div>
        
        <div class="phone-numbers">
          <span>📱 +243 834 171 852</span><br>
          <span style="font-size: 16px; color: #94a3b8;">ou</span><br>
          <span>📱 +243 856 163 550</span>
        </div>
        
        <div class="company-name">
          YOUPI. MAIL
        </div>
        
        <div style="font-size: 13px; color: #cbd5e1; margin-top: 10px;">
          Solution d'envoi d'emails professionnels
        </div>
        
        <div class="copyright">
          © ${currentYear} Youpi. Tous droits réservés.<br>
          <span style="color: #64748b; font-size: 11px;">
            Conçu avec ❤️ en RDC
          </span>
        </div>
      </div>
      
    </div>
  </body>
  </html>`;
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
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

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
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE attachments (
      id SERIAL PRIMARY KEY,
      email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
      filename VARCHAR(255),
      file_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

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
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX idx_emails_user_id ON emails(user_id);
    CREATE INDEX idx_emails_folder ON emails(folder);
    CREATE INDEX idx_emails_created_at ON emails(created_at DESC);
    CREATE INDEX idx_emails_destinator_id ON emails(destinator_id);
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
  
  const checkTemplateTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'email_templates'
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
      SELECT FROM information_schema.tables WHERE table_name = 'template_versions'
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
      SELECT FROM information_schema.tables WHERE table_name = 'email_designs'
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX idx_email_designs_destinator_id ON email_designs(destinator_id);
    `);
  }
  
  const checkIndexes = await dbPool.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'emails'
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
          html_content: '<p>Template d\'accueil</p>',
          text_content: "Bienvenue chez Youpi!",
          variables: '[]',
          is_system: true
        },
        {
          name: 'password_reset',
          category: 'security',
          subject: 'Réinitialisation de votre mot de passe',
          html_content: '<p>Réinitialisation du mot de passe</p>',
          text_content: "Réinitialisation du mot de passe",
          variables: '[]',
          is_system: true
        }
      ];
      
      for (const template of defaultTemplates) {
        await dbPool.query(
          `INSERT INTO email_templates (name, category, subject, html_content, text_content, variables, is_system) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [template.name, template.category, template.subject, template.html_content, template.text_content, template.variables, template.is_system]
        );
      }
      console.log(`✅ ${defaultTemplates.length} templates système créés`);
    }

    const existingDesigns = await dbPool.query('SELECT COUNT(*) FROM email_designs');
    
    if (parseInt(existingDesigns.rows[0].count) === 0) {
      console.log("📋 Création des designs par destinataire...");
      
      const defaultDesigns = [
        {
          destinator_id: 'marketing',
          design_name: 'Design Marketing - Promotionnel',
          subject: '✨ {{subject}} - Offre spéciale',
          html_content: '{{contenu_principal}}',
          text_content: '{{contenu_principal}}',
          variables: '["contenu_principal", "subject"]',
          category: 'marketing'
        },
        {
          destinator_id: 'partner',
          design_name: 'Design Partenaire - Professionnel',
          subject: '🤝 {{subject}} - Partenariat',
          html_content: '{{contenu_principal}}',
          text_content: '{{contenu_principal}}',
          variables: '["contenu_principal", "subject"]',
          category: 'professional'
        },
        {
          destinator_id: 'ad',
          design_name: 'Design Publicité - Événementiel',
          subject: '📢 {{subject}}',
          html_content: '{{contenu_principal}}',
          text_content: '{{contenu_principal}}',
          variables: '["contenu_principal", "subject"]',
          category: 'advertising'
        },
        {
          destinator_id: 'other',
          design_name: 'Design Standard - Général',
          subject: '✉️ {{subject}}',
          html_content: '{{contenu_principal}}',
          text_content: '{{contenu_principal}}',
          variables: '["contenu_principal", "subject"]',
          category: 'general'
        }
      ];
      
      for (const design of defaultDesigns) {
        await dbPool.query(
          `INSERT INTO email_designs (destinator_id, design_name, subject, html_content, text_content, variables, category) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [design.destinator_id, design.design_name, design.subject, design.html_content, design.text_content, design.variables, design.category]
        );
      }
      console.log(`✅ ${defaultDesigns.length} designs par destinataire créés`);
    }
  } catch (error) {
    console.error("❌ Erreur création templates/designs:", error.message);
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

// ===== ROUTE PRINCIPALE D'ENVOI D'EMAIL AVEC DESIGN UNIFIÉ =====
app.post("/api/emails/send", authenticateToken, async (req, res) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  console.log(`\n📧 ENVOI EMAIL [ID:${requestId}]`);
  
  try {
    const { to, subject, message, folder = 'sent', destinator_id = 'other' } = req.body;
    const user_id = req.userId;
    
    if (!to || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: "Données manquantes: to, subject et message sont requis"
      });
    }
    
    console.log(`📤 Envoi email de user ${user_id} à ${to} [destinataire: ${destinator_id}]`);
    
    const userResult = await dbPool.query('SELECT email FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Utilisateur non trouvé" });
    }
    const userEmail = userResult.rows[0].email;
    
    console.log("✅ Validation réussie en", Date.now() - startTime, "ms");
    
    // Générer le HTML avec le design unifié
    const designHtml = getUnifiedEmailDesign(message, subject, userEmail, destinator_id);
    
    console.log("⏳ Tentative d'envoi via SendGrid Web API...");
    console.log(`   Design unifié avec image Base64 pour ${destinator_id}`);
    
    const client = getSendGridClient();
    
    const emailData = {
      to: to,
      subject: subject,
      text: message,
      html: designHtml,
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
    
    const emailResult = await dbPool.query(
      `INSERT INTO emails (user_id, to_email, subject, content, status, sendgrid_message_id, folder, destinator_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, created_at`,
      [user_id, to, subject, message, 'sent', result.messageId, folder, destinator_id]
    );
    
    res.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
      details: `Email envoyé avec succès à "${to}"`,
      from: process.env.SMTP_SENDER,
      replyTo: userEmail,
      to: to,
      subject: subject,
      processingTime: `${totalTime}ms`,
      sendMethod: "SendGrid Web API",
      requestId: requestId,
      email_id: emailResult.rows[0].id,
      destinator_id: destinator_id,
      design: "unifié-header-body-footer"
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    if (req.userId) {
      try {
        await dbPool.query(
          `INSERT INTO emails (user_id, to_email, subject, content, status, error_detail, folder, destinator_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.userId, req.body.to, req.body.subject, req.body.message, 'failed', error.message, 'failed', req.body.destinator_id || 'other']
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

// ===== AUTRES ROUTES EMAIL =====
app.get("/api/emails", authenticateToken, async (req, res) => {
  try {
    const user_id = req.userId;
    const { page = 1, limit = 50, folder, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM emails WHERE user_id = $1';
    const params = [user_id];
    let paramCount = 2;
    
    if (folder && folder !== 'all') {
      query += ` AND folder = $${paramCount}`;
      params.push(folder);
      paramCount++;
    }
    
    if (status) {
      query += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    if (search) {
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
        folder: email.folder || 'inbox',
        destinator_id: email.destinator_id,
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
        destinator_id: email.destinator_id,
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

app.post("/api/emails/draft", authenticateToken, async (req, res) => {
  try {
    const { to, subject, content, destinator_id = 'other' } = req.body;
    const user_id = req.userId;
    
    const result = await dbPool.query(
      `INSERT INTO emails (user_id, to_email, subject, content, status, folder, destinator_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [user_id, to || '', subject || '', content || '', 'draft', 'drafts', destinator_id]
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

app.put("/api/emails/:email_id", authenticateToken, async (req, res) => {
  try {
    const { email_id } = req.params;
    const user_id = req.userId;
    const { to, subject, content, folder, status, destinator_id } = req.body;
    
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
    if (destinator_id !== undefined) {
      updates.push(`destinator_id = $${paramCount}`);
      values.push(destinator_id);
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

// ===== ROUTES DESIGNS (simplifiées) =====
app.get("/api/designs/destinator/:destinator_id", authenticateToken, async (req, res) => {
  try {
    const { destinator_id } = req.params;
    
    const result = await dbPool.query(
      `SELECT id, destinator_id, design_name, subject, category, is_active, created_at
       FROM email_designs 
       WHERE destinator_id = $1 AND is_active = true`,
      [destinator_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Design non trouvé" });
    }
    
    res.json({
      success: true,
      design: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération design:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====
app.get("/", (req, res) => {
  res.json({
    message: "Youpi. API - Design Email Unifié",
    status: "online",
    version: "5.0.0",
    timestamp: new Date().toISOString(),
    features: [
      "PostgreSQL", 
      "SendGrid API", 
      "Authentification", 
      "Design email unifié",
      "Header avec image Base64",
      "Body avec texte justifié",
      "Footer avec contacts opérations"
    ],
    design: {
      header: "Image bannière Base64 ou titre dégradé",
      body: "Texte justifié avec styles adaptés au destinataire",
      footer: "Numéros de téléphone: +243 834 171 852 / +243 856 163 550"
    },
    endpoints: {
      auth: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/auth/profile"],
      emails: ["POST /api/emails/send", "GET /api/emails", "POST /api/emails/draft"],
      utils: ["GET /api/health", "GET /api/setup-database"]
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
      console.error("Erreur santé DB:", dbError.message);
    }
    
    const sendgridStatus = process.env.SENDGRID_API_KEY ? "✅ configuré" : "❌ manquant";
    const imageStatus = getBannerImageBase64() ? "✅ présente" : "❌ non trouvée";
    
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: dbStatus,
        sendgrid: sendgridStatus,
        banner_image: imageStatus,
        db_time: dbTime
      },
      memory: {
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
        rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`
      }
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
      message: "Base de données vérifiée et mise à jour",
      tables: ["users", "emails", "attachments", "email_templates", "template_versions", "email_designs"]
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
    message: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

// ===== DÉMARRAGE =====
console.log("🔍 Démarrage de l'application...");
console.log("📦 Variables d'environnement:");
console.log("- PORT:", process.env.PORT);
console.log("- DATABASE_URL:", process.env.DATABASE_URL ? "Présente" : "Manquante");
console.log("- SENDGRID_API_KEY:", process.env.SENDGRID_API_KEY ? "Présente" : "Manquante");
console.log("- SMTP_SENDER:", process.env.SMTP_SENDER || "Manquant");

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

process.on('unhandledRejection', (reason) => {
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
      console.log(`📊 Env: ${process.env.NODE_ENV || 'development'}`);
      console.log(`⏰ Démarrage: ${new Date().toISOString()}`);
      console.log(`🎨 Design: UNIFIÉ avec image Base64`);
      console.log(`📱 Contacts: +243 834 171 852 / +243 856 163 550`);
      console.log("=".repeat(70));
    });
    
    const shutdown = (signal) => {
      console.log(`\n🛑 Signal ${signal} reçu - Arrêt...`);
      server.close(() => {
        console.log('✅ Serveur arrêté');
        if (dbPool) {
          dbPool.end(() => process.exit(0));
        } else {
          process.exit(0);
        }
      });
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    console.error("💥 IMPOSSIBLE DE DÉMARRER:", error);
    process.exit(1);
  }
};

startServer();

module.exports = app;