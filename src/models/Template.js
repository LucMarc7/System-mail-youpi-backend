const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

class Template {
  static async findAll() {
    const result = await pool.query('SELECT * FROM templates');
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async create({ name, html }) {
    const result = await pool.query(
      'INSERT INTO templates (name, html) VALUES ($1, $2) RETURNING *',
      [name, html]
    );
    return result.rows[0];
  }
}

module.exports = Template;