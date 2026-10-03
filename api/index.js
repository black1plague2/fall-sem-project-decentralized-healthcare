// Vercel serverless entry point. src/app.js only calls app.listen() when run
// directly (`require.main === module`); importing it here just builds the
// Express app and lets @vercel/node wrap it as a request handler.
module.exports = require('../src/app');
