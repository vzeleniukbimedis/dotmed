require('dotenv').config();
const { login } = require('../src/dotmedAuth');

login()
  .then(() => {
    console.log('OK: залогінились успішно, сесію збережено в data/dotmed-session.json');
  })
  .catch((err) => {
    console.error('FAIL:', err.message);
    process.exitCode = 1;
  });
