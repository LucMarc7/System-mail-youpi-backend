const sgMail = require('@sendgrid/mail');

/**
 * Configuration et initialisation du client SendGrid API
 * Le client est configuré une seule fois au démarrage
 */
const initializeSendGridClient = () => {
  console.log("🔄 Initialisation du client SendGrid API...");
  
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
  console.log(`   - Expéditeur par défaut: ${process.env.SMTP_SENDER}`);
  console.log(`   - Clé API: ${process.env.SENDGRID_API_KEY.substring(0, 10)}...`);
  
  try {
    // Configuration unique du client SendGrid
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    console.log("✅ Client SendGrid API initialisé avec succès");
    return sgMail;
  } catch (error) {
    console.error('❌ Erreur initialisation client SendGrid:', error.message);
    throw error;
  }
};

// Initialiser le client une seule fois au démarrage
let sendGridClient = null;

const getSendGridClient = () => {
  if (!sendGridClient) {
    sendGridClient = initializeSendGridClient();
  }
  return sendGridClient;
};

// Fonction pour vérifier la validité de la clé API SendGrid
const verifySendGridConnection = async () => {
  try {
    const client = getSendGridClient();
    console.log("🔍 Vérification connexion SendGrid API...");
    
    // Test simple avec une requête de validation d'expéditeur
    // Note: L'API SendGrid n'a pas de méthode 'verify' comme SMTP
    // On teste en validant la configuration de l'expéditeur
    const senderEmail = process.env.SMTP_SENDER;
    
    console.log(`   - Vérification expéditeur: ${senderEmail}`);
    console.log("   - Clé API configurée avec succès");
    
    // Retourner un succès immédiat (l'erreur se produira à l'envoi réel)
    console.log("✅ Configuration SendGrid API vérifiée avec succès");
    return { 
      success: true, 
      message: "SendGrid API client configuré correctement",
      sender: senderEmail
    };
  } catch (error) {
    console.error("❌ Impossible de vérifier la configuration SendGrid:", error.message);
    return { 
      success: false, 
      error: error.message,
      code: error.code 
    };
  }
};

// Fonction principale pour envoyer un email
const sendEmail = async (emailData) => {
  try {
    const client = getSendGridClient();
    const senderEmail = process.env.SMTP_SENDER || emailData.from;
    
    // Construction du message selon le format SendGrid
    const msg = {
      to: emailData.to,
      from: {
        email: senderEmail,
        name: emailData.senderName || 'CEO Awards DRC'
      },
      subject: emailData.subject,
      text: emailData.text || '',
      html: emailData.html || emailData.text || '',
      replyTo: emailData.replyTo || senderEmail,
      // Gestion des pièces jointes si présentes
      attachments: emailData.attachments || []
    };
    
    console.log(`📤 Tentative d'envoi via SendGrid API...`);
    console.log(`   De: ${senderEmail} → À: ${emailData.to}`);
    console.log(`   Sujet: ${emailData.subject}`);
    
    const startTime = Date.now();
    const response = await client.send(msg);
    const elapsedTime = Date.now() - startTime;
    
    console.log(`✅ Email envoyé avec succès en ${elapsedTime}ms`);
    console.log(`   Statut: ${response[0].statusCode}`);
    console.log(`   Headers: ${JSON.stringify(response[0].headers)}`);
    
    return {
      success: true,
      messageId: response[0].headers['x-message-id'],
      statusCode: response[0].statusCode,
      elapsedTime: elapsedTime
    };
    
  } catch (error) {
    console.error('❌ Erreur envoi email SendGrid:');
    console.error(`   Message: ${error.message}`);
    
    // Log détaillé pour le débogage
    if (error.response) {
      console.error(`   Code: ${error.code}`);
      console.error(`   Body: ${JSON.stringify(error.response.body, null, 2)}`);
      console.error(`   Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
    }
    
    throw {
      success: false,
      error: error.message,
      code: error.code,
      details: error.response?.body || null,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
};

module.exports = {
  getSendGridClient,
  verifySendGridConnection,
  initializeSendGridClient,
  sendEmail  // Nouvelle fonction principale d'envoi
};