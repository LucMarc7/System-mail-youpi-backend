const express = require('express');
const router = express.Router();
const { getSendGridTransporter } = require('../config/nodemailer');

/**
 * Route POST /api/emails/send - CORRIGÉE avec timeout
 * Cette route envoie un email via SendGrid avec gestion de timeout
 */
router.post("/send", async (req, res) => {
  const startTime = Date.now();
  console.log("=".repeat(50));
  console.log("📧 DÉBUT - Envoi email via SendGrid");
  console.log("=".repeat(50));
  
  try {
    const { 
      to, 
      subject, 
      message, 
      destinator = "other", 
      attachments = [], 
      userEmail 
    } = req.body;

    // Log des données reçues (sans les pièces jointes complètes)
    console.log("📋 DONNÉES REÇUES:");
    console.log("- Destinataire (to):", to || "NON FOURNI");
    console.log("- Sujet (subject):", subject || "NON FOURNI");
    console.log("- Message length:", message ? message.length : 0, "caractères");
    console.log("- Destinator:", destinator);
    console.log("- Email expéditeur (userEmail):", userEmail || "NON FOURNI");
    console.log("- Attachments count:", attachments.length);
    
    // VALIDATION RAPIDE (doit être rapide)
    const errors = [];
    if (!to) errors.push("Destinataire requis");
    if (!subject) errors.push("Sujet requis");
    if (!message) errors.push("Message requis");
    if (!userEmail) errors.push("Email expéditeur requis");
    
    // Validation format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (to && !emailRegex.test(to)) errors.push("Format email destinataire invalide");
    if (userEmail && !emailRegex.test(userEmail)) errors.push("Format email expéditeur invalide");

    if (errors.length > 0) {
      console.log("❌ Validation échouée:", errors);
      return res.status(400).json({
        success: false,
        error: errors.join(", "),
        timestamp: new Date().toISOString(),
        validationTime: `${Date.now() - startTime}ms`
      });
    }

    console.log("✅ Validation réussie");
    
    // Récupération du transporteur
    const transporter = getSendGridTransporter();
    const senderEmail = process.env.SMTP_SENDER;
    
    console.log(`📤 Préparation email: ${senderEmail} → ${to}`);
    
    // Préparation des options de l'email
    const mailOptions = {
      from: `"Youpi" <${senderEmail}>`,
      replyTo: userEmail,
      to: to,
      subject: subject,
      text: message,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">✉️ Youpi</h1>
            <p style="margin: 5px 0 0; opacity: 0.9;">Email envoyé via votre application</p>
          </div>
          <div style="padding: 30px;">
            <h2 style="color: #333; margin-top: 0;">${subject}</h2>
            <div style="color: #555; line-height: 1.6; white-space: pre-line;">${message.replace(/\n/g, '<br>')}</div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #888; font-size: 0.9em;">
              <strong>Destinataire type :</strong> ${destinator}<br>
              <strong>Expéditeur :</strong> ${userEmail}<br>
              <em>Cet email a été envoyé via Youpi System Mail.</em>
            </p>
          </div>
        </div>
      `
    };

    // Gestion des pièces jointes
    if (attachments && attachments.length > 0) {
      console.log(`📎 Ajout de ${attachments.length} pièce(s) jointe(s)`);
      mailOptions.attachments = attachments.map((att, index) => ({
        filename: att.name || `attachment-${index + 1}`,
        content: att.content,
        encoding: 'base64',
        contentType: att.type || 'application/octet-stream'
      }));
    }

    // ENVOI AVEC TIMEOUT - CORRECTION CRITIQUE
    console.log("⏳ Début envoi SendGrid...");
    
    // Création d'une promesse avec timeout
    const sendWithTimeout = () => {
      return new Promise((resolve, reject) => {
        // Timeout de 15 secondes maximum
        const timeoutId = setTimeout(() => {
          reject(new Error("Timeout: SendGrid n'a pas répondu après 15 secondes"));
        }, 15000);
        
        // Envoi via Nodemailer
        transporter.sendMail(mailOptions, (error, info) => {
          clearTimeout(timeoutId);
          if (error) {
            reject(error);
          } else {
            resolve(info);
          }
        });
      });
    };

    // Exécution avec gestion d'erreur
    const info = await sendWithTimeout();
    const totalTime = Date.now() - startTime;
    
    console.log(`✅ Email accepté par SendGrid en ${totalTime}ms`);
    console.log("📨 Message ID:", info.messageId);
    console.log("📨 Réponse SendGrid:", info.response ? info.response.substring(0, 100) + "..." : "OK");
    console.log("=".repeat(50));
    
    // Réponse RAPIDE au client
    res.json({
      success: true,
      messageId: info.messageId,
      timestamp: new Date().toISOString(),
      details: `Email envoyé avec succès de "${senderEmail}" à "${to}"`,
      from: senderEmail,
      replyTo: userEmail,
      to: to,
      subject: subject,
      destinator: destinator,
      attachmentsCount: attachments.length,
      processingTime: `${totalTime}ms`,
      simulated: false,
      provider: "SendGrid"
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ ERREUR après ${totalTime}ms:`, error.message);
    console.error("❌ Stack trace:", error.stack);
    
    // Messages d'erreur clairs
    let userMessage = "Échec de l'envoi de l'email";
    let statusCode = 500;
    
    if (error.message.includes("Timeout")) {
      userMessage = "SendGrid est trop lent à répondre. Veuillez réessayer.";
      statusCode = 504; // Gateway Timeout
    } else if (error.code === 'EAUTH') {
      userMessage = "Erreur d'authentification SendGrid. Vérifiez votre clé API.";
    } else if (error.code === 'EENVELOPE') {
      userMessage = "Erreur dans les adresses email.";
      statusCode = 400;
    }
    
    res.status(statusCode).json({
      success: false,
      error: userMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      processingTime: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;