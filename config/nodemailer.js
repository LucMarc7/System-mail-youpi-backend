const nodemailer = require('nodemailer');

/**
 * Configuration et création du transporteur SendGrid
 * Ce transporteur est créé une seule fois et réutilisé
 */
const createSendGridTransporter = () => {
  console.log("🔄 Initialisation du transporteur SendGrid...");
  
  // Vérification des variables d'environnement
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ ERREUR CRITIQUE: SENDGRID_API_KEY non définie');
    throw new Error("SENDGRID_API_KEY manquante dans les variables d'environnement");
  }
  
  if (!process.env.SMTP_SENDER) {
    console.error('❌ ERREUR CRITIQUE: SMTP_SENDER non définie');
    throw new Error("SMTP_SENDER manquante dans les variables d'environnement");
  }
  
  console.log(`✅ Variables SendGrid détectées`);
  console.log(`   - Expéditeur: ${process.env.SMTP_SENDER}`);
  console.log(`   - Clé API: ${process.env.SENDGRID_API_KEY.substring(0, 10)}...`);
  
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false, // true pour le port 465, false pour le port 587
      auth: {
        user: "apikey", // TOUJOURS 'apikey' pour SendGrid
        pass: process.env.SENDGRID_API_KEY
      },
      // Configuration de timeout pour éviter les blocages
      connectionTimeout: 70000, // 10 secondes max pour la connexion
      greetingTimeout: 70000,   // 10 secondes max pour le greeting
      socketTimeout: 65000,     // 15 secondes max pour les opérations socket
      // Options de débogage
      debug: process.env.NODE_ENV === 'development',
      logger: process.env.NODE_ENV === 'development'
    });
    
    console.log("✅ Transporteur SendGrid initialisé avec succès");
    return transporter;
  } catch (error) {
    console.error('❌ Erreur création transporteur:', error.message);
    throw error;
  }
};

// Créer le transporteur une seule fois au démarrage
let transporterInstance = null;

const getSendGridTransporter = () => {
  if (!transporterInstance) {
    transporterInstance = createSendGridTransporter();
  }
  return transporterInstance;
};

// Fonction pour vérifier la connexion SendGrid
const verifySendGridConnection = async () => {
  try {
    const transporter = getSendGridTransporter();
    console.log("🔍 Vérification connexion SendGrid...");
    
    const result = await new Promise((resolve, reject) => {
      transporter.verify((error, success) => {
        if (error) {
          console.error("❌ Échec vérification SendGrid:", error.message);
          reject(error);
        } else {
          console.log("✅ Connexion SendGrid vérifiée avec succès");
          resolve(success);
        }
      });
    });
    
    return { success: true, result };
  } catch (error) {
    console.error("❌ Impossible de vérifier la connexion SendGrid:", error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  getSendGridTransporter,
  verifySendGridConnection,
  createSendGridTransporter
};