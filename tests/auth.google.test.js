// tests/auth.google.test.js
const request = require('supertest');

// Import de l'app (sans démarrer le serveur grâce au if(require.main === module))
const app = require('../src/index');

describe('POST /api/auth/google - Authentification Google', () => {
  it('devrait simuler l\'authentification Google avec un token valide', async () => {
    const fakeToken = 'fake_token_1234567890';
    
    const response = await request(app)
      .post('/api/auth/google')
      .send({ token: fakeToken })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.user.email).toBe('test@example.com');
    expect(response.body.smtpCredentials.server).toBe('smtp.gmail.com');
  });

  it('devrait accepter une requête sans token (simulation actuelle)', async () => {
    const response = await request(app)
      .post('/api/auth/google')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('devrait accepter un token vide (simulation actuelle)', async () => {
    const response = await request(app)
      .post('/api/auth/google')
      .send({ token: '' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe('GET /api/health - Vérification du serveur', () => {
  it('devrait retourner un statut OK avec les bonnes informations', async () => {
    const response = await request(app)
      .get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
    expect(response.body.service).toBe('Youpi Mail Backend');
    expect(response.body.timestamp).toBeDefined();
  });
});