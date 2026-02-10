function generateTemplate(destinator, data) {
  let template = '';

  switch (destinator) {
    case 'marketing':
      template = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 10px; text-align: center; }
            .content { padding: 20px; }
            .footer { background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Marketing Email</h1>
            </div>
            <div class="content">
              <p>${data.message}</p>
            </div>
            <div class="footer">
              <p>Youpi. &copy; 2026</p>
            </div>
          </div>
        </body>
        </html>
      `;
      break;
    case 'partner':
      template = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #e9ecef; padding: 10px; text-align: center; }
            .content { padding: 20px; }
            .footer { background-color: #e9ecef; padding: 10px; text-align: center; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Partner Email</h1>
            </div>
            <div class="content">
              <p>${data.message}</p>
            </div>
            <div class="footer">
              <p>Youpi. &copy; 2026</p>
            </div>
          </div>
        </body>
        </html>
      `;
      break;
    case 'ad':
      template = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #d4edda; padding: 10px; text-align: center; }
            .content { padding: 20px; }
            .footer { background-color: #d4edda; padding: 10px; text-align: center; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Publicité Email</h1>
            </div>
            <div class="content">
              <p>${data.message}</p>
            </div>
            <div class="footer">
              <p>Youpi. &copy; 2026</p>
            </div>
          </div>
        </body>
        </html>
      `;
      break;
    case 'other':
    default:
      template = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 10px; text-align: center; }
            .content { padding: 20px; }
            .footer { background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>General Email</h1>
            </div>
            <div class="content">
              <p>${data.message}</p>
            </div>
            <div class="footer">
              <p>Youpi. &copy; 2026</p>
            </div>
          </div>
        </body>
        </html>
      `;
  }

  return template;
}

module.exports = { generateTemplate };