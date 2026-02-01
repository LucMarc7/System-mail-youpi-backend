// server/test-email.js
console.log('🧪 Début du test d\'envoi SendGrid...\n');

// 1. Charge la configuration et le service
require('dotenv').config({ path: '.env' });
const { sendEmail } = require('./src/services/emailService');

// 2. Fonction de test principale
async function runTest() {
  console.log('1. Vérification de la clé API...');
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ ERREUR: SENDGRID_API_KEY non trouvée dans .env');
    console.log('   Vérifiez que votre fichier .env contient: SENDGRID_API_KEY=VOTRE_CLE');
    return;
  }
  console.log('   ✅ Clé API détectée (début: ' + process.env.SENDGRID_API_KEY.substring(0, 10) + '...)\n');

  console.log('2. Tentative d\'envoi d\'un email test...');
  
  try {
    const result = await sendEmail({
      to: 'lucmarckazadi@gmail.com', // 👈 À CHANGER ICI !
      subject: 'Test Youpi Mail - ' + new Date().toLocaleTimeString(),
      html: `
        <h1>Test réussi ! 🎉</h1>
        <p>Ceci est un email test envoyé depuis votre application <strong>Youpi Mail</strong>.</p>
        <p>Expéditeur: infos@ceoawardsdrc.com</p>
        <p>Date: ${new Date().toLocaleString()}</p>
      `
    });
    
    console.log('   ✅ TEST RÉUSSI !');
    console.log('   📧 Message ID:', result.messageId);
    console.log('\n➡️  Vérifiez votre boîte de réception (et les spams).');
    
  } catch (error) {
    console.error('   ❌ TEST ÉCHOUÉ:', error.message);
    
    // Messages d'erreur courants et leurs solutions
    if (error.message.includes('Unauthorized')) {
      console.log('\n🔍 SOLUTION: Votre clé API SendGrid est invalide.');
      console.log('   - Vérifiez la clé dans le fichier .env');
      console.log('   - Regénérez-en une dans SendGrid: Settings > API Keys');
    } else if (error.message.includes('Forbidden')) {
      console.log('\n🔍 SOLUTION: L\'expéditeur "infos@ceoawardsdrc.com" n\'est pas vérifié.');
      console.log('   - Allez dans SendGrid: Settings > Sender Authentication');
      console.log('   - Vérifiez que cette adresse est bien "Verified"');
    } else {
      console.log('\n🔍 Vérifiez la connexion internet et la configuration SendGrid.');
    }
  }
}

// 3. Lance le test
runTest();