const { sendEmail } = require('../services/emailService');

/**
 * Contrôleur pour l'envoi d'emails via SendGrid API
 */
exports.sendEmail = async (req, res) => {
  // ID unique pour le suivi des logs
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`📨 [${requestId}] Début traitement requête d'envoi d'email`);
  console.log(`   - IP: ${req.ip}`);
  console.log(`   - User-Agent: ${req.get('User-Agent')?.substring(0, 50)}...`);
  
  try {
    // 1. VALIDATION DES DONNÉES D'ENTRÉE
    console.log(`🔍 [${requestId}] Validation des données d'entrée...`);
    
    const { to, subject, message, destinator, userEmail } = req.body;
    
    // Validation des champs obligatoires
    if (!to) {
      throw new Error('Le champ "to" (destinataire) est obligatoire');
    }
    if (!subject) {
      throw new Error('Le champ "subject" (sujet) est obligatoire');
    }
    if (!message) {
      throw new Error('Le champ "message" (contenu) est obligatoire');
    }
    
    // Validation basique du format email (à améliorer selon vos besoins)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      throw new Error('Format du destinataire (to) invalide');
    }
    
    console.log(`✅ [${requestId}] Validation des données réussie`);
    console.log(`   - Destinataire: ${to}`);
    console.log(`   - Sujet: ${subject}`);
    console.log(`   - Destinator: ${destinator || 'Non spécifié'}`);
    console.log(`   - Longueur message: ${message.length} caractères`);

    // 2. GÉNÉRATION DU CONTENU HTML (selon votre logique métier)
    console.log(`🎨 [${requestId}] Génération du contenu HTML...`);
    
    let htmlContent = '';
    
    // Exemple de logique conditionnelle basée sur le 'destinator'
    if (destinator === 'marketing') {
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
            <h2 style="color: #333;">Message Marketing</h2>
            <div style="background-color: white; padding: 20px; border-radius: 3px; margin-top: 15px;">
              ${message}
            </div>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              Ceci est un email marketing envoyé par CEO Awards DRC
            </p>
          </div>
        </div>
      `;
    } else if (destinator === 'support') {
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #e3f2fd; padding: 20px; border-radius: 5px;">
            <h2 style="color: #1565c0;">Support Technique</h2>
            <div style="background-color: white; padding: 20px; border-radius: 3px; margin-top: 15px;">
              ${message}
            </div>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              Notre équipe support vous répondra dans les plus brefs délais.
            </p>
          </div>
        </div>
      `;
    } else {
      // Template par défaut
      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f4f4f4; padding: 20px; border-radius: 5px;">
              <h2 style="margin-top: 0;">${subject}</h2>
              <div style="background-color: white; padding: 20px; border-radius: 3px; margin: 15px 0;">
                ${message.replace(/\n/g, '<br>')}
              </div>
              <hr style="border: none; border-top: 1px solid #ddd;">
              <p style="font-size: 12px; color: #777; text-align: center;">
                Cet email a été envoyé depuis le système CEO Awards DRC<br>
                ${userEmail ? `Envoyé par: ${userEmail}` : ''}
              </p>
            </div>
          </div>
        </body>
        </html>
      `;
    }
    
    console.log(`✅ [${requestId}] HTML généré: ${htmlContent.length} caractères`);

    // 3. PRÉPARATION DES PIÈCES JOINTES (si Multer est configuré)
    console.log(`📎 [${requestId}] Traitement des pièces jointes...`);
    
    let attachments = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      attachments = req.files.map(file => ({
        content: file.buffer.toString('base64'), // SendGrid attend du base64
        filename: file.originalname,
        type: file.mimetype,
        disposition: 'attachment'
      }));
      console.log(`   - ${attachments.length} pièce(s) jointe(s) attachée(s)`);
    }

    // 4. APPEL AU SERVICE D'ENVOI
    console.log(`🚀 [${requestId}] Appel au service d'envoi d'email...`);
    const startTime = Date.now();
    
    const result = await sendEmail({
      to: to,
      subject: subject,
      text: message, // Version texte brut pour les clients qui ne supportent pas HTML
      html: htmlContent,
      replyTo: userEmail || process.env.SMTP_SENDER, // Reply-To personnalisé
      senderName: destinator ? `CEO Awards DRC - ${destinator}` : 'CEO Awards DRC',
      attachments: attachments
    });
    
    const elapsedTime = Date.now() - startTime;
    
    console.log(`✅ [${requestId}] Email envoyé avec succès en ${elapsedTime}ms`);
    console.log(`   - Message ID: ${result.messageId || 'N/A'}`);
    console.log(`   - Statut: ${result.statusCode}`);

    // 5. RÉPONSE DE SUCCÈS
    res.status(202).json({
      success: true,
      message: 'Email envoyé avec succès',
      requestId: requestId,
      data: {
        messageId: result.messageId,
        statusCode: result.statusCode,
        to: to,
        subject: subject,
        elapsedTime: elapsedTime,
        attachmentsCount: attachments.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    // 6. GESTION D'ERREUR DÉTAILLÉE
    console.error(`❌ [${requestId}] Erreur lors de l'envoi de l'email:`);
    console.error(`   - Message: ${error.message}`);
    console.error(`   - Stack: ${error.stack}`);
    
    // Classification des erreurs pour des réponses HTTP appropriées
    let statusCode = 500;
    let errorType = 'InternalServerError';
    
    if (error.message.includes('obligatoire') || error.message.includes('Format')) {
      statusCode = 400;
      errorType = 'ValidationError';
    } else if (error.message.includes('SendGrid') || error.message.includes('API')) {
      statusCode = 502; // Bad Gateway
      errorType = 'ServiceProviderError';
    }
    
    // Réponse d'erreur structurée
    res.status(statusCode).json({
      success: false,
      error: {
        type: errorType,
        message: error.message,
        code: error.code || 'EMAIL_SEND_FAILED',
        requestId: requestId,
        timestamp: new Date().toISOString()
      },
      // Ne pas exposer les détails internes en production
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        fullError: error
      } : undefined
    });
  } finally {
    // 7. NETTOYAGE ET LOG FINAL
    console.log(`🏁 [${requestId}] Fin du traitement (${Date.now() - parseInt(requestId.split('_')[1])}ms total)`);
  }
};

/**
 * Fonction utilitaire pour valider un tableau d'emails
 * (À utiliser si vous supportez plusieurs destinataires)
 */
function validateEmails(emails) {
  if (!Array.isArray(emails)) {
    emails = [emails];
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = emails.filter(email => !emailRegex.test(email));
  
  if (invalidEmails.length > 0) {
    throw new Error(`Emails invalides: ${invalidEmails.join(', ')}`);
  }
  
  return emails;
}