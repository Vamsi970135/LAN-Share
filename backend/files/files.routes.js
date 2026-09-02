const router  = require('express').Router();
const multer  = require('multer');
const ctrl    = require('./files.controller.js');

const upload  = multer({ storage: multer.memoryStorage() });

router.post('/upload',        upload.single('file'), ctrl.uploadFile);
router.get('/download/:cid',  ctrl.downloadFile);
router.post('/register-cid',  ctrl.registerCid);
router.get('/my-files',       ctrl.getMyFiles);
router.get('/stats',          ctrl.getStats);

module.exports = router;
