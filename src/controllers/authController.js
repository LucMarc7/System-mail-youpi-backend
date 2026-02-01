const { verifyGoogleToken } = require('../services/googleAuthService');
const jwt = require('jsonwebtoken');

exports.googleAuth = async (req, res) => {
  try {
    const { token } = req.body;
    const userInfo = await verifyGoogleToken(token);
    
    // Ici, vous pouvez enregistrer l'utilisateur en base de données si nécessaire
    // Pour l'instant, on retourne un token JWT simple
    const jwtToken = jwt.sign(
      { email: userInfo.email, name: userInfo.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token: jwtToken, user: userInfo });
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: 'Invalid token' });
  }
};