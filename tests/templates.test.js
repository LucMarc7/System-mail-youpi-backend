// tests/templates.test.js
const request = require('supertest');

const app = require('../src/index');

describe('GET /api/templates/preview - Génération de templates', () => {
  it('devrait retourner le template marketing en HTML', async () => {
    const response = await request(app)
      .get('/api/templates/preview?destinator=marketing');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<html>');
    expect(response.text).toContain('Offre Marketing');
    expect(response.text).toContain('linear-gradient');
  });

  it('devrait retourner le template partner en HTML', async () => {
    const response = await request(app)
      .get('/api/templates/preview?destinator=partner');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Collaboration Partenaire');
    expect(response.text).toContain('#f8f9fa');
  });

  it('devrait retourner le template ad en HTML', async () => {
    const response = await request(app)
      .get('/api/templates/preview?destinator=ad');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Promotion Spéciale');
    expect(response.text).toContain('#ff6b6b');
  });

  it('devrait retourner le template other quand aucun destinator n\'est spécifié', async () => {
    const response = await request(app)
      .get('/api/templates/preview');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Email Standard');
    expect(response.text).toContain('background: white');
  });

  it('devrait retourner le template other pour un destinator inconnu', async () => {
    const response = await request(app)
      .get('/api/templates/preview?destinator=inconnu');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Email Standard');
  });
});