// server/src/services/emailService.js
require('dotenv').config(); // Charge les variables depuis .env
const sgMail = require('@sendgrid/mail');

// Configurez la clé API depuis la variable d'environnement
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail({ to, subject, html, attachments = [], userEmail }) {
  const msg = {
    to: to,
    from: userEmail || process.env.SENDGRID_FROM_EMAIL, // Priorité à l'email utilisateur
    subject: subject,
    html: html,
    text: html.replace(/<[^>]*>/g, ''),
    attachments: attachments,
  };

  try {
    const response = await sgMail.send(msg);
    console.log(`✅ Email envoyé à ${to}. ID: ${response[0].headers['x-message-id']}`);
    return { 
      success: true, 
      messageId: response[0].headers['x-message-id']
    };
  } catch (error) {
    console.error('❌ Erreur SendGrid :', error.response?.body?.errors || error.message);
    throw new Error(`Échec d'envoi: ${error.message}`);
  }
}

module.exports = { sendEmail };