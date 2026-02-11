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
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Créer des index
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
    console.log("📋 Ajout de la colonne 'folder' à la table emails...");
    await dbPool.query('ALTER TABLE emails ADD COLUMN folder VARCHAR(50) DEFAULT \'inbox\'');
  }
  
  if (!existingColumns.includes('updated_at')) {
    console.log("📋 Ajout de la colonne 'updated_at' à la table emails...");
    await dbPool.query('ALTER TABLE emails ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()');
  }
  
  if (!existingColumns.includes('destinator_id')) {
    console.log("📋 Ajout de la colonne 'destinator_id' à la table emails...");
    await dbPool.query('ALTER TABLE emails ADD COLUMN destinator_id VARCHAR(50)');
  }
  
  if (!existingColumns.includes('design_id')) {
    console.log("📋 Ajout de la colonne 'design_id' à la table emails...");
    await dbPool.query('ALTER TABLE emails ADD COLUMN design_id INTEGER');
  }
  
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
  
  const checkDesignsTable = await dbPool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'email_designs'
    )
  `);
  
  if (!checkDesignsTable.rows[0].exists) {
    console.log("📋 Création de la table 'email_designs'...");
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

    // === CRÉATION DES DESIGNS PAR DESTINATAIRE ===
    const existingDesigns = await dbPool.query(
      'SELECT COUNT(*) FROM email_designs'
    );
    
    if (parseInt(existingDesigns.rows[0].count) === 0) {
      console.log("📋 Création des designs par destinataire...");
      
      const templatesResult = await dbPool.query(
        `SELECT id, name FROM email_templates WHERE is_system = true`
      );
      
      const templateMap = {};
      templatesResult.rows.forEach(t => {
        if (t.name === 'newsletter') templateMap.newsletter = t.id;
        if (t.name === 'meeting_confirmation') templateMap.meeting = t.id;
      });

      const defaultDesigns = [
        {
          destinator_id: 'marketing',
          design_name: 'Design Marketing - Promotionnel',
          subject: '✨ {{offer_title}} - Offre spéciale Youpi.',
          html_content: `<div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 32px;">{{offer_title}}</h1>
              <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin-top: 10px;">{{offer_subtitle}}</p>
            </div>
            
            <div style="padding: 40px 30px; background: white;">
              <div style="font-size: 16px; line-height: 1.8; color: #333;">
                {{contenu_principal}}
              </div>
              
              <div style="background: #f8f9fa; border-radius: 10px; padding: 25px; margin: 30px 0; text-align: center;">
                <p style="font-size: 24px; font-weight: bold; color: #667eea;">{{offer_price}}</p>
                <a href="{{cta_link}}" style="display: inline-block; background: #667eea; color: white; padding: 15px 40px; text-decoration: none; border-radius: 25px; font-weight: bold; margin-top: 10px;">
                  {{cta_text}}
                </a>
              </div>
              
              <p style="color: #666; font-size: 14px; text-align: center;">
                Offre valable jusqu'au {{valid_until}}
              </p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #eaeaea;">
              <p style="color: #999; font-size: 12px;">
                {{company_name}} · {{company_address}}<br>
                <a href="{{unsubscribe_link}}" style="color: #667eea; text-decoration: none;">Se désabonner</a>
              </p>
            </div>
          </div>`,
          text_content: "{{offer_title}}\n\n{{contenu_principal}}\n\nPrix: {{offer_price}}\n{{cta_text}}: {{cta_link}}",
          variables: '["contenu_principal", "offer_title", "offer_subtitle", "offer_price", "cta_link", "cta_text", "valid_until", "company_name", "company_address", "unsubscribe_link"]',
          category: 'marketing'
        },
        {
          destinator_id: 'partner',
          design_name: 'Design Partenaire - Professionnel',
          subject: '🤝 {{subject}} - Partenariat Youpi.',
          html_content: `<div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; background: white;">
            <div style="border-bottom: 3px solid #10b981; padding: 30px 30px 20px;">
              <h1 style="color: #10b981; margin: 0; font-size: 24px;">{{company_name}}</h1>
            </div>
            
            <div style="padding: 40px 30px; background: white;">
              <p style="font-size: 16px; color: #4a5568; margin-bottom: 20px;">Bonjour {{contact_name}},</p>
              
              <div style="font-size: 16px; line-height: 1.8; color: #2d3748;">
                {{contenu_principal}}
              </div>
              
              <div style="border-left: 4px solid #10b981; background: #f0fdf4; padding: 20px; margin: 30px 0;">
                <p style="margin: 0; font-weight: bold; color: #10b981;">📌 Prochaine étape</p>
                <p style="margin: 10px 0 0 0;">{{next_step}}</p>
              </div>
              
              <p style="color: #718096; font-size: 14px; margin-top: 30px;">
                Cordialement,<br>
                <strong>{{sender_name}}</strong><br>
                {{sender_position}}<br>
                <span style="color: #10b981;">{{sender_phone}} | {{sender_email}}</span>
              </p>
            </div>
            
            <div style="background: #f8fafc; padding: 30px; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 12px; text-align: center;">
                {{company_name}} · {{company_address}}<br>
                N° de TVA: {{vat_number}} · {{company_email}}
              </p>
            </div>
          </div>`,
          text_content: "Bonjour {{contact_name}},\n\n{{contenu_principal}}\n\nProchaine étape: {{next_step}}\n\nCordialement,\n{{sender_name}}\n{{sender_position}}\n{{sender_phone}}\n{{sender_email}}",
          variables: '["contenu_principal", "company_name", "contact_name", "next_step", "sender_name", "sender_position", "sender_phone", "sender_email", "vat_number", "company_address", "company_email", "subject"]',
          category: 'professional'
        },
        {
          destinator_id: 'ad',
          design_name: 'Design Publicité - Événementiel',
          subject: '📢 {{event_title}} - Ne manquez pas ça !',
          html_content: `<div style="font-family: 'Helvetica', sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #f59e0b; padding: 20px; text-align: center;">
              <span style="background: white; color: #f59e0b; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 14px;">
                {{badge_text}}
              </span>
            </div>
            
            <div style="background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 36px; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);">
                {{event_title}}
              </h1>
              <p style="color: white; font-size: 20px; margin-top: 10px; opacity: 0.95;">
                {{event_subtitle}}
              </p>
            </div>
            
            <div style="padding: 40px 30px; background: white;">
              <div style="background: #fff7ed; border-radius: 10px; padding: 30px; margin-bottom: 30px;">
                <div style="display: flex; justify-content: space-around; text-align: center;">
                  <div>
                    <p style="color: #f59e0b; font-size: 14px; margin-bottom: 5px;">📅 DATE</p>
                    <p style="font-weight: bold; margin: 0;">{{event_date}}</p>
                  </div>
                  <div>
                    <p style="color: #f59e0b; font-size: 14px; margin-bottom: 5px;">⏰ HEURE</p>
                    <p style="font-weight: bold; margin: 0;">{{event_time}}</p>
                  </div>
                  <div>
                    <p style="color: #f59e0b; font-size: 14px; margin-bottom: 5px;">📍 LIEU</p>
                    <p style="font-weight: bold; margin: 0;">{{event_location}}</p>
                  </div>
                </div>
              </div>
              
              <div style="font-size: 16px; line-height: 1.8; color: #333;">
                {{contenu_principal}}
              </div>
              
              <div style="text-align: center; margin-top: 40px;">
                <a href="{{registration_link}}" style="display: inline-block; background: #f59e0b; color: white; padding: 15px 45px; text-decoration: none; border-radius: 30px; font-weight: bold; font-size: 18px;">
                  {{cta_text}}
                </a>
                <p style="color: #999; font-size: 12px; margin-top: 15px;">
                  {{spots_left}} places restantes
                </p>
              </div>
            </div>
            
            <div style="background: #1f2937; padding: 30px; text-align: center;">
              <p style="color: white; margin: 0; font-size: 14px;">
                {{organizer_name}}<br>
                <span style="color: #f59e0b;">{{contact_phone}} · {{contact_email}}</span>
              </p>
            </div>
          </div>`,
          text_content: "{{event_title}} - {{event_subtitle}}\n\nDate: {{event_date}} à {{event_time}}\nLieu: {{event_location}}\n\n{{contenu_principal}}\n\nInscription: {{registration_link}}",
          variables: '["contenu_principal", "event_title", "event_subtitle", "badge_text", "event_date", "event_time", "event_location", "registration_link", "cta_text", "spots_left", "organizer_name", "contact_phone", "contact_email"]',
          category: 'advertising'
        },
        {
          destinator_id: 'other',
          design_name: 'Design Standard - Général',
          subject: '✉️ {{subject}}',
          html_content: `<div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; background: white;">
            <div style="padding: 30px; border-bottom: 2px solid #6b7280;">
              <h1 style="color: #6b7280; margin: 0; font-size: 20px; font-weight: normal;">
                {{header_text}}
              </h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <div style="font-size: 16px; line-height: 1.8; color: #374151;">
                {{contenu_principal}}
              </div>
              
              <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px;">
                  <strong>Informations complémentaires:</strong><br>
                  {{additional_info}}
                </p>
              </div>
            </div>
            
            <div style="background: #f3f4f6; padding: 20px 30px; text-align: center;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                {{footer_text}}<br>
                <span style="color: #9ca3af;">{{timestamp}}</span>
              </p>
            </div>
          </div>`,
          text_content: "{{subject}}\n\n{{contenu_principal}}\n\n{{additional_info}}\n\n{{footer_text}}",
          variables: '["contenu_principal", "subject", "header_text", "additional_info", "footer_text", "timestamp"]',
          category: 'general'
        }
      ];
      
      for (const design of defaultDesigns) {
        let template_id = null;
        if (design.destinator_id === 'marketing' && templateMap.newsletter) {
          template_id = templateMap.newsletter;
        } else if (design.destinator_id === 'partner' && templateMap.meeting) {
          template_id = templateMap.meeting;
        }
        
        await dbPool.query(
          `INSERT INTO email_designs 
           (destinator_id, design_name, template_id, subject, html_content, text_content, variables, category) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            design.destinator_id,
            design.design_name,
            template_id,
            design.subject,
            design.html_content,
            design.text_content,
            design.variables,
            design.category
          ]
        );
      }
      
      console.log(`✅ ${defaultDesigns.length} designs par destinataire créés`);
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

// ===== ROUTES EMAIL =====

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
    
    let designHtml;
    let designSubject;
    let designId = null;
    
    try {
      const designResult = await dbPool.query(
        `SELECT id, subject, html_content 
         FROM email_designs 
         WHERE destinator_id = $1 AND is_active = true`,
        [destinator_id]
      );
      
      if (designResult.rows.length > 0) {
        const design = designResult.rows[0];
        designId = design.id;
        
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
        
        console.log(`✅ Design trouvé: ${designResult.rows[0].id} pour ${destinator_id}`);
      } else {
        console.log(`ℹ️ Aucun design trouvé pour ${destinator_id}, utilisation du design par défaut`);
      }
    } catch (designError) {
      console.log("ℹ️ Erreur récupération design:", designError.message);
    }
    
    if (!designHtml) {
      designHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .content { padding: 30px; background: white; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Youpi.</h1>
          </div>
          <div class="content">
            <h2>${subject}</h2>
            <div>${message.replace(/\n/g, '<br>')}</div>
            <hr style="margin: 30px 0;">
            <p><strong>De:</strong> ${userEmail}</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Youpi. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>`;
      designSubject = subject;
    }
    
    const finalSubject = designSubject || subject;
    
    console.log("⏳ Tentative d'envoi via SendGrid Web API...");
    console.log(`   Design utilisé: ${designId ? designId : 'Défaut'} pour ${destinator_id}`);
    
    const client = getSendGridClient();
    
    const emailData = {
      to: to,
      subject: finalSubject,
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
      `INSERT INTO emails (user_id, to_email, subject, content, status, sendgrid_message_id, folder, destinator_id, design_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING id, created_at`,
      [user_id, to, finalSubject, message, 'sent', result.messageId, folder, destinator_id, designId]
    );
    
    res.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
      details: `Email envoyé avec succès de "${process.env.SMTP_SENDER}" à "${to}" via SendGrid Web API`,
      from: process.env.SMTP_SENDER,
      replyTo: userEmail,
      to: to,
      subject: finalSubject,
      processingTime: `${totalTime}ms`,
      sendMethod: "SendGrid Web API (HTTPS)",
      requestId: requestId,
      email_id: emailResult.rows[0].id,
      destinator_id: destinator_id,
      design_id: designId
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
        design_id: email.design_id,
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
        design_id: email.design_id,
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

// ===== ROUTES TEMPLATES EMAIL =====

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
    
    if (category) {
      query += ` AND category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }
    
    if (active_only === 'true') {
      query += ` AND is_active = true`;
    }
    
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

app.post("/api/templates/:id/generate", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { variables = {} } = req.body;
    
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
    
    const replaceVariables = (content, vars) => {
      if (!content) return content;
      let result = content;
      for (const [key, value] of Object.entries(vars)) {
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(placeholder, value || '');
      }
      return result;
    };
    
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
    
    const result = await dbPool.query(
      `INSERT INTO email_templates 
       (name, category, subject, html_content, text_content, variables, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, category, subject, created_at`,
      [name, category, subject, html_content, text_content, JSON.stringify(variables), is_active, req.userId]
    );
    
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
    
    const currentResult = await dbPool.query(
      'SELECT version FROM template_versions WHERE template_id = $1 ORDER BY version DESC LIMIT 1',
      [id]
    );
    
    const currentVersion = currentResult.rows.length > 0 ? currentResult.rows[0].version : 0;
    const newVersion = currentVersion + 1;
    
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

app.delete("/api/templates/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
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
    
    const sourceResult = await dbPool.query(
      'SELECT * FROM email_templates WHERE id = $1',
      [id]
    );
    
    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Template source non trouvé" });
    }
    
    const source = sourceResult.rows[0];
    
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

// ===== ROUTES DESIGNS PAR DESTINATAIRE =====

app.get("/api/designs/destinator/:destinator_id", authenticateToken, async (req, res) => {
  try {
    const { destinator_id } = req.params;
    
    const result = await dbPool.query(
      `SELECT id, destinator_id, design_name, template_id, subject, 
              html_content, text_content, variables, category, is_active, created_at, updated_at
       FROM email_designs 
       WHERE destinator_id = $1 AND is_active = true`,
      [destinator_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Design non trouvé pour ce destinataire" 
      });
    }
    
    res.json({
      success: true,
      design: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération design par destinataire:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

app.get("/api/designs", authenticateToken, async (req, res) => {
  try {
    const { active_only = 'true' } = req.query;
    
    let query = `
      SELECT d.id, d.destinator_id, d.design_name, d.template_id, 
             d.subject, d.category, d.is_active, d.created_at,
             t.name as template_name
      FROM email_designs d
      LEFT JOIN email_templates t ON d.template_id = t.id
    `;
    
    const params = [];
    
    if (active_only === 'true') {
      query += ` WHERE d.is_active = true`;
    }
    
    query += ` ORDER BY d.destinator_id`;
    
    const result = await dbPool.query(query, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      designs: result.rows
    });
    
  } catch (error) {
    console.error("❌ Erreur récupération designs:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

app.post("/api/designs/generate", authenticateToken, async (req, res) => {
  try {
    const { destinator_id, content, variables = {} } = req.body;
    
    if (!destinator_id || !content) {
      return res.status(400).json({ 
        success: false, 
        error: "destinator_id et content sont requis" 
      });
    }
    
    const designResult = await dbPool.query(
      `SELECT subject, html_content, text_content, variables as available_variables
       FROM email_designs 
       WHERE destinator_id = $1 AND is_active = true`,
      [destinator_id]
    );
    
    if (designResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Aucun design trouvé pour ce destinataire" 
      });
    }
    
    const design = designResult.rows[0];
    
    const replaceVariables = (template, vars) => {
      if (!template) return template;
      let result = template;
      
      if (vars.contenu_principal) {
        result = result.replace(/{{contenu_principal}}/g, vars.contenu_principal);
      } else {
        result = result.replace(/{{contenu_principal}}/g, content);
      }
      
      for (const [key, value] of Object.entries(vars)) {
        if (key !== 'contenu_principal') {
          const placeholder = new RegExp(`{{${key}}}`, 'g');
          result = result.replace(placeholder, value || '');
        }
      }
      
      result = result.replace(/{{[^}]+}}/g, '');
      
      return result;
    };
    
    const allVariables = {
      ...variables,
      contenu_principal: content
    };
    
    const generated = {
      subject: replaceVariables(design.subject, allVariables),
      html: replaceVariables(design.html_content, allVariables),
      text: replaceVariables(design.text_content || content, allVariables),
      destinator_id,
      variables_used: Object.keys(allVariables)
    };
    
    res.json({
      success: true,
      generated
    });
    
  } catch (error) {
    console.error("❌ Erreur génération email avec design:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

app.post("/api/designs/destinator/:destinator_id", authenticateToken, async (req, res) => {
  try {
    const { destinator_id } = req.params;
    const { 
      design_name, 
      subject, 
      html_content, 
      text_content, 
      variables = [],
      template_id = null,
      category = 'destinator'
    } = req.body;
    
    if (!design_name || !subject || !html_content) {
      return res.status(400).json({ 
        success: false, 
        error: "design_name, subject et html_content sont requis" 
      });
    }
    
    const existingResult = await dbPool.query(
      'SELECT id FROM email_designs WHERE destinator_id = $1',
      [destinator_id]
    );
    
    if (existingResult.rows.length > 0) {
      const result = await dbPool.query(
        `UPDATE email_designs 
         SET design_name = $1, template_id = $2, subject = $3, 
             html_content = $4, text_content = $5, variables = $6, 
             category = $7, updated_at = NOW()
         WHERE destinator_id = $8
         RETURNING *`,
        [
          design_name, 
          template_id, 
          subject, 
          html_content, 
          text_content || '', 
          JSON.stringify(variables), 
          category, 
          destinator_id
        ]
      );
      
      res.json({
        success: true,
        message: "Design mis à jour",
        design: result.rows[0]
      });
    } else {
      const result = await dbPool.query(
        `INSERT INTO email_designs 
         (destinator_id, design_name, template_id, subject, html_content, text_content, variables, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          destinator_id,
          design_name,
          template_id,
          subject,
          html_content,
          text_content || '',
          JSON.stringify(variables),
          category
        ]
      );
      
      res.status(201).json({
        success: true,
        message: "Design créé",
        design: result.rows[0]
      });
    }
    
  } catch (error) {
    console.error("❌ Erreur création/mise à jour design:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

app.patch("/api/designs/:id/toggle", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        error: "is_active (boolean) est requis" 
      });
    }
    
    const result = await dbPool.query(
      `UPDATE email_designs 
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, destinator_id, design_name, is_active`,
      [is_active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Design non trouvé" });
    }
    
    res.json({
      success: true,
      message: `Design ${is_active ? 'activé' : 'désactivé'}`,
      design: result.rows[0]
    });
    
  } catch (error) {
    console.error("❌ Erreur activation/désactivation design:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ===== ROUTES UTILITAIRES =====

app.get("/", (req, res) => {
  res.json({
    message: "Youpi. API avec Base de Données",
    status: "online",
    version: "4.0.0",
    timestamp: new Date().toISOString(),
    features: ["PostgreSQL", "SendGrid API", "Authentification", "Gestion emails", "Dossiers", "Templates", "Designs par destinataire"],
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
      designs: [
        "GET /api/designs",
        "GET /api/designs/destinator/:destinator_id",
        "POST /api/designs/generate",
        "POST /api/designs/destinator/:destinator_id",
        "PATCH /api/designs/:id/toggle"
      ],
      utils: ["GET /api/health", "GET /api/setup-database"]
    },
    documentation: "https://system-mail-youpi-backend.onrender.com"
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

app.get("/api/setup-database", async (req, res) => {
  try {
    await createTables();
    await createDefaultTemplatesAndDesigns();
    res.json({ 
      success: true, 
      message: "Base de données vérifiée et mise à jour avec succès",
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
      "GET /api/designs (authentifié)",
      "POST /api/designs/generate (authentifié)",
      "GET /api/setup-database"
    ]
  });
});

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

console.log("🔍 Démarrage de l'application...");
console.log("📦 Variables d'environnement disponibles:");
console.log("- PORT:", process.env.PORT);
console.log("- DATABASE_URL:", process.env.DATABASE_URL ? "Présente (masquée)" : "Manquante");
console.log("- SENDGRID_API_KEY:", process.env.SENDGRID_API_KEY ? "Présente (masquée)" : "Manquante");
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
      console.log(`🎨 Designs disponibles: marketing, partner, ad, other`);
      console.log("=".repeat(70));
    });
    
    server.on('error', (error) => {
      console.error("💥 Erreur du serveur HTTP:", error);
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Le port ${PORT} est déjà utilisé`);
      }
    });
    
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