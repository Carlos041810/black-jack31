// Esto NO funcionaría con tu llamada actual
const express = require('express');
const router = express.Router();

router.get('/mesas', (req, res) => { res.send('Hola'); });

module.exports = router; 
