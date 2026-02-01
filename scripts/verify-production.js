const axios = require('axios');
require('dotenv').config({ path: '.env.production' });

async function verifyProduction() {
  const BASE_URL = process.env.API_URL || 'http://localhost:8080';
  
  console.log('🔍 Vérification de la production Youpi Mail...');
  
  const tests = [
    { name: 'Health Check', method: 'get', url: '/api/health' },
    { name: 'Template Preview', method: 'get', url: '/api/templates/preview?destinator=marketing' },
  ];
  
  for (const test of tests) {
    try {
      const response = await axios[test.method](`${BASE_URL}${test.url}`);
      console.log(`✅ ${test.name}: ${response.status}`);
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
    }
  }
  
  console.log('\n📋 Vérification des variables d\'environnement:');
  const requiredVars = ['NODE_ENV', 'DATABASE_URL', 'SENDGRID_API_KEY', 'GOOGLE_CLIENT_ID'];
  requiredVars.forEach(varName => {
    console.log(`${process.env[varName] ? '✅' : '❌'} ${varName}: ${process.env[varName] ? 'Défini' : 'Manquant'}`);
  });
}

verifyProduction();