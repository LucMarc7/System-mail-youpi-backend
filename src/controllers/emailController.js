const { sendEmail } = require('../services/emailService');

exports.sendEmail = async (req, res) => {
  try {
    const { to, subject, message, destinator } = req.body;
    // Ici, vous pourriez générer le HTML final à partir du 'destinator' et du 'message'
    const htmlContent = `<p>${message}</p>`; // Remplacez par votre logique de template

    const result = await sendEmail({
      to,
      subject,
      html: htmlContent,
      // Transformez vos pièces jointes si nécessaire
      attachments: req.files ? req.files.map(f => ({ content: f.buffer, filename: f.originalname })) : []
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};