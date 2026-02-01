const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

class User {
  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }

  static async create({ email, name, googleId }) {
    const result = await pool.query(
      'INSERT INTO users (email, name, google_id) VALUES ($1, $2, $3) RETURNING *',
      [email, name, googleId]
    );
    return result.rows[0];
  }
}

module.exports = User;