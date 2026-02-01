const express = require('express');
const { previewTemplate } = require('../controllers/templateController');

const router = express.Router();

router.get('/preview', previewTemplate);

module.exports = router;