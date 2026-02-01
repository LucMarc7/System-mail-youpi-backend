const { generateTemplate } = require('../services/templateService');

exports.previewTemplate = (req, res) => {
  const { destinator } = req.query;
  const html = generateTemplate(destinator, { message: 'Contenu exemple' });
  res.send(html);
};