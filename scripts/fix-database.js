// scripts/fix-database.js
const { Pool } = require('pg');
require('dotenv').config();

const fixDatabase = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("🔧 MAINTENANCE BASE DE DONNÉES");
    console.log("=".repeat(50));

    // 1. Vérifier la table attachments
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'attachments'
      )
    `);

    if (tableCheck.rows[0].exists) {
      console.log("✅ Table 'attachments' trouvée");

      // 2. Vérifier les colonnes
      const columnsCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'attachments'
      `);
      
      const columns = columnsCheck.rows.map(row => row.column_name);
      console.log("📋 Colonnes existantes:", columns.join(', '));

      // 3. Ajouter les colonnes manquantes
      if (!columns.includes('original_filename')) {
        console.log("➕ Ajout de 'original_filename'...");
        await pool.query(`
          ALTER TABLE attachments 
          ADD COLUMN original_filename VARCHAR(255)
        `);
      }

      if (!columns.includes('file_size')) {
        console.log("➕ Ajout de 'file_size'...");
        await pool.query(`
          ALTER TABLE attachments 
          ADD COLUMN file_size BIGINT DEFAULT 0
        `);
      }

      if (!columns.includes('mime_type')) {
        console.log("➕ Ajout de 'mime_type'...");
        await pool.query(`
          ALTER TABLE attachments 
          ADD COLUMN mime_type VARCHAR(255) DEFAULT 'application/octet-stream'
        `);
      }

      // 4. Mettre à jour les données
      const updateResult = await pool.query(`
        UPDATE attachments 
        SET original_filename = filename 
        WHERE original_filename IS NULL AND filename IS NOT NULL
      `);
      console.log(`✅ ${updateResult.rowCount} enregistrements mis à jour`);

      // 5. Créer l'index
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_attachments_email_id 
        ON attachments(email_id)
      `);
      console.log("✅ Index créé");

    } else {
      console.log("⚠️ Table 'attachments' n'existe pas encore");
    }

    console.log("=".repeat(50));
    console.log("✅ MAINTENANCE TERMINÉE");

  } catch (error) {
    console.error("❌ Erreur:", error);
  } finally {
    await pool.end();
  }
};

fixDatabase();