// routes/binanceRoutes.js
const express = require('express');
const router = express.Router();

const verify = require('../controllers/verifyBinanceKeys');
const save = require('../controllers/saveBinanceKeys');
const sync = require('../controllers/syncBinance');

router.post('/verify-binance-keys', verify);
router.post('/save-binance-keys', save);
router.post('/sync-binance-p2p', sync);

module.exports = router;