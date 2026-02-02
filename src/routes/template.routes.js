const express = require('express');
const router = express.Router();

// Route de génération de template
router.get("/preview", (req, res) => {
  try {
    const { destinator = "marketing" } = req.query;
    
    console.log("🎨 Génération template:", { destinator });

    const templates = {
      marketing:
        '<html><body style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; font-family: Arial, sans-serif; text-align: center;">' +
        '<h1 style="font-size: 2.5rem; margin-bottom: 20px;">🎯 Offre Marketing Exclusive</h1>' +
        '<p style="font-size: 1.2rem; line-height: 1.6;">Template professionnel optimisé pour vos campagnes marketing et communications commerciales.</p>' +
        '<div style="margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">' +
        '<p style="font-style: italic;">"L\'excellence au service de votre communication"</p>' +
        '</div></body></html>',
      
      partner:
        '<html><body style="background: #f8f9fa; color: #333; padding: 40px; font-family: Arial, sans-serif;">' +
        '<h1 style="color: #10b981; border-bottom: 2px solid #10b981; padding-bottom: 10px;">🤝 Proposition de Partenariat</h1>' +
        '<p style="line-height: 1.6; font-size: 1.1rem;">Template formel et élégant pour les communications professionnelles entre partenaires.</p>' +
        '<div style="margin-top: 30px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">' +
        '<p>Pour une collaboration fructueuse et durable.</p>' +
        '</div></body></html>',
      
      ad:
        '<html><body style="background: #ff6b6b; color: white; padding: 40px; text-align: center; font-family: Arial, sans-serif;">' +
        '<h1 style="font-size: 2.8rem; margin-bottom: 20px;">📢 PROMOTION EXCEPTIONNELLE !</h1>' +
        '<p style="font-size: 1.3rem; margin-bottom: 30px;">Template accrocheur et dynamique pour vos publicités et offres spéciales.</p>' +
        '<div style="background: white; color: #ff6b6b; padding: 15px 30px; border-radius: 50px; display: inline-block; font-weight: bold; font-size: 1.2rem;">' +
        'LIMITÉ À 24H !' +
        '</div></body></html>',
      
      other:
        '<html><body style="background: white; color: #333; padding: 40px; border: 1px solid #ddd; font-family: Arial, sans-serif;">' +
        '<h1 style="color: #4F46E5;">✉️ Communication Professionnelle</h1>' +
        '<p style="line-height: 1.6;">Template simple, polyvalent et efficace pour toutes vos communications.</p>' +
        '<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">' +
        '<p style="color: #666; font-size: 0.9rem;">Message professionnel et structuré</p>' +
        '</div></body></html>',
    };

    const html = templates[destinator] || templates.other;
    
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache");
    res.send(html);
  } catch (error) {
    console.error("❌ Erreur génération template:", error);
    res.status(500).send("<html><body><h1>Erreur de génération du template</h1></body></html>");
  }
});

module.exports = router;