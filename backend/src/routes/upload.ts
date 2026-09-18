import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/authenticate.js';
import { uploadToR2 } from '../lib/r2.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file provided' });

    try {
        const url = await uploadToR2(file.buffer, file.mimetype, 'tours');
        if (url) {
            return res.json({ url });
        }
        // R2 not configured — fall back to returning a data URL, preserving legacy in-DB storage behaviour.
        const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
        res.json({ url: dataUrl });
    } catch (err: any) {
        console.error('[upload] failed:', err);
        res.status(500).json({ error: err.message || 'Upload failed' });
    }
});

export default router;
