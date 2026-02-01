// tests/email.send.test.js
const request = require('supertest');

// Import de l'app
const app = require('../src/index');

describe('POST /api/emails/send - Envoi d\'email', () => {
  it('devrait envoyer un email simulé avec succès quand les données sont complètes', async () => {
    const emailData = {
      to: 'client@example.com',
      subject: 'Test d\'envoi Youpi Mail',
      message: 'Ceci est un message de test pour Youpi Mail.',
      destinator: 'marketing'
    };

    const response = await request(app)
      .post('/api/emails/send')
      .send(emailData)
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.messageId).toMatch(/^simulated_\d+$/);
    expect(response.body.details).toContain('Email simulé vers client@example.com');
    expect(response.body.timestamp).toBeDefined();
  });

  it('devrait accepter un email sans destinator spécifié', async () => {
    const emailData = {
      to: 'client@example.com',
      subject: 'Test sans destinator',
      message: 'Message de test'
    };

    const response = await request(app)
      .post('/api/emails/send')
      .send(emailData);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('devrait retourner une erreur 400 si le champ "to" est manquant', async () => {
    const invalidData = {
      subject: 'Test sans destinataire',
      message: 'Ce message n\'a pas de destinataire.'
    };

    const response = await request(app)
      .post('/api/emails/send')
      .send(invalidData);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("'to'");
  });

  it('devrait retourner une erreur 400 si le champ "subject" est manquant', async () => {
    const invalidData = {
      to: 'client@example.com',
      message: 'Message sans sujet.'
    };

    const response = await request(app)
      .post('/api/emails/send')
      .send(invalidData);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("'subject'");
  });

  it('devrait retourner une erreur 400 si le champ "message" est manquant', async () => {
    const invalidData = {
      to: 'client@example.com',
      subject: 'Test sans message'
    };

    const response = await request(app)
      .post('/api/emails/send')
      .send(invalidData);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("'message'");
  });

  it('devrait accepter un tableau de pièces jointes vide', async () => {
    const emailData = {
      to: 'client@example.com',
      subject: 'Test avec pièces jointes vides',
      message: 'Message test',
      attachments: []
    };

    const response = await request(app)
      .post('/api/emails/send')
      .send(emailData);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});