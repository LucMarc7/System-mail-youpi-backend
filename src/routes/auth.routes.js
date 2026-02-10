const express = require('express');
const router = express.Router();

// Route santé
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Youpi",
    uptime: process.uptime(),
    emailProvider: "SendGrid",
    memory: {
      heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`
    }
  });
});

// Route d'inscription
router.post("/register", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    console.log("📝 Tentative d'inscription:", { 
      email, 
      fullName: fullName || "Non spécifié",
      passwordLength: password ? password.length : 0 
    });
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Email et mot de passe requis" 
      });
    }
    
    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Format d'email invalide"
      });
    }
    
    // Validation mot de passe
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Le mot de passe doit contenir au moins 6 caractères"
      });
    }
    
    const token = `jwt_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    res.json({
      success: true,
      token,
      user: { 
        id: `user_${Date.now()}`,
        email: email.trim().toLowerCase(), 
        fullName: (fullName || email.split('@')[0]).trim(),
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Erreur inscription:", error);
    res.status(500).json({
      success: false,
      error: "Erreur interne du serveur"
    });
  }
});

// Route de connexion
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log("🔐 Tentative de connexion:", { 
      email,
      passwordLength: password ? password.length : 0 
    });
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Email et mot de passe requis" 
      });
    }
    
    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Format d'email invalide"
      });
    }
    
    const token = `jwt_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    res.json({
      success: true,
      token,
      user: { 
        id: "user_123",
        email: email.trim().toLowerCase(), 
        name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
        fullName: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)
      }
    });
  } catch (error) {
    console.error("❌ Erreur connexion:", error);
    res.status(500).json({
      success: false,
      error: "Erreur interne du serveur"
    });
  }
});

// Route Google Auth
router.post("/google", (req, res) => {
  try {
    const { token, provider = "google", userInfo } = req.body;

    console.log(`🔐 Connexion via ${provider}:`, { 
      tokenLength: token?.length || 0,
      userInfo: userInfo ? {
        email: userInfo.email,
        name: userInfo.name,
        hasPhoto: !!userInfo.photo
      } : "Non fourni"
    });

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Token Google requis"
      });
    }

    const googleToken = `google_jwt_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    res.json({
      success: true,
      user: {
        id: userInfo?.id || `google_${Date.now()}`,
        email: userInfo?.email || "test@example.com",
        name: userInfo?.name || "Utilisateur Google",
        fullName: userInfo?.name || "Utilisateur Google",
        picture: userInfo?.photo || "https://ui-avatars.com/api/?name=" + encodeURIComponent(userInfo?.name || "User"),
      },
      smtpCredentials: {
        server: "smtp.gmail.com",
        port: 587,
        username: userInfo?.email || "test@example.com",
      },
      token: googleToken,
    });
  } catch (error) {
    console.error("❌ Erreur Google auth:", error);
    res.status(500).json({
      success: false,
      error: "Erreur d'authentification Google"
    });
  }
});

// Route de vérification token
router.post("/verify", (req, res) => {
  const { token } = req.body;
  
  console.log("🔍 Vérification token:", token ? "Présent" : "Absent");
  
  if (!token) {
    return res.json({
      success: false,
      valid: false,
      error: "Token manquant"
    });
  }
  
  const isValid = token.startsWith("jwt_") || token.startsWith("google_jwt_");
  
  res.json({
    success: true,
    valid: isValid,
    user: isValid ? {
      id: "user_verified",
      email: "verified@example.com",
      name: "Utilisateur Vérifié"
    } : null
  });
});

module.exports = router;