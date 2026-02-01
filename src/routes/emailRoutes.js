const express = require('express');
const { sendEmail } = require('../controllers/emailController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/send', authMiddleware, sendEmail);

module.exports = router;