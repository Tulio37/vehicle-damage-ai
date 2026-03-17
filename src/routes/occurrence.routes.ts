import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { uploadMiddleware } from '../middleware/upload.middleware';
import {
  getOrCreateOccurrence,
  uploadAndAnalyzeMedia,
  getAnalysisResult,
  saveHumanReview,
  updateManualDescription,
  submitOccurrence,
  saveOperationalReview,
  getOccurrencesByReservation,
  getOccurrencesByVehicle,
  getPendingOperationalReview,
  getOccurrenceById,
} from '../services/occurrence.service';
import { AnalysisStatus, HumanReviewRequest } from '../types';

const router = Router();

// ─── POST /occurrences/init ───────────────────────────────────────────────────
// Initialize a new occurrence session for a reservation
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { reservationId, vehicleId, userId, plate, vehicleModel } = req.body;

    if (!reservationId || !vehicleId || !userId || !plate) {
      return res.status(400).json({ error: 'Campos obrigatórios: reservationId, vehicleId, userId, plate' });
    }

    const occ = await getOrCreateOccurrence(reservationId, vehicleId, userId, plate, vehicleModel || '');

    return res.status(201).json({
      occurrenceId: occ._id,
      reservationId: occ.reservationId,
      vehicleId: occ.vehicleId,
      status: occ.status,
      message: 'Sessão de registro de avaria iniciada.',
    });
  } catch (err) {
    console.error('[Route] POST /occurrences/init:', err);
    return res.status(500).json({ error: 'Erro interno ao iniciar registro.' });
  }
});

// ─── POST /occurrences/:occurrenceId/media ────────────────────────────────────
// Upload a photo and trigger AI analysis
router.post(
  '/:occurrenceId/media',
  uploadMiddleware.single('file'),
  async (req: Request, res: Response) => {
    const { occurrenceId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {
      const occurrenceIndex = parseInt(req.body.occurrenceIndex || '1', 10);
      const mediaIndex = parseInt(req.body.mediaIndex || '1', 10);
      const userId = req.body.userId || 'anonymous';

      if (mediaIndex < 1 || mediaIndex > 3) {
        return res.status(400).json({ error: 'mediaIndex deve ser 1, 2 ou 3.' });
      }

      const { mediaId, analysisId } = await uploadAndAnalyzeMedia({
        occurrenceId,
        occurrenceIndex,
        mediaIndex,
        tempFilePath: file.path,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        userId,
      });

      // Clean up temp file
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }

      return res.status(201).json({
        mediaId,
        occurrenceId,
        analysisId,
        analysisStatus: AnalysisStatus.QUEUED,
        message: 'Foto recebida. Análise em andamento.',
      });
    } catch (err) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      console.error('[Route] POST /media:', err);
      return res.status(500).json({ error: 'Erro ao processar upload.' });
    }
  },
);

// ─── GET /occurrences/:occurrenceId/media/:mediaId/analysis ──────────────────
// Poll for AI analysis result
router.get('/:occurrenceId/media/:mediaId/analysis', async (req: Request, res: Response) => {
  const { occurrenceId, mediaId } = req.params;

  try {
    const analysis = await getAnalysisResult(occurrenceId, mediaId);

    if (!analysis) {
      return res.status(404).json({ error: 'Análise não encontrada.' });
    }

    if (analysis.status === AnalysisStatus.QUEUED || analysis.status === AnalysisStatus.PROCESSING) {
      return res.status(200).json({
        analysisId: analysis.analysisId,
        status: analysis.status,
        estimatedSeconds: 5,
        message: 'Análise em andamento...',
      });
    }

    return res.status(200).json(analysis);
  } catch (err) {
    console.error('[Route] GET /analysis:', err);
    return res.status(500).json({ error: 'Erro ao buscar análise.' });
  }
});

// ─── POST /occurrences/:occurrenceId/media/:mediaId/review ───────────────────
// Save human review action (confirm / correct / discard)
router.post('/:occurrenceId/media/:mediaId/review', async (req: Request, res: Response) => {
  const { occurrenceId, mediaId } = req.params;

  try {
    const { action, correctedData, notes, occurrenceIndex, userId } = req.body as
      HumanReviewRequest & { occurrenceIndex: number; userId: string };

    if (!action) {
      return res.status(400).json({ error: 'Campo obrigatório: action (confirmed | corrected | discarded)' });
    }

    const saved = await saveHumanReview(
      occurrenceId,
      mediaId,
      occurrenceIndex || 1,
      { action, correctedData, notes },
      userId || 'anonymous',
    );

    if (!saved) {
      return res.status(404).json({ error: 'Mídia não encontrada para revisão.' });
    }

    return res.status(200).json({
      mediaId,
      action,
      message: 'Revisão salva com sucesso.',
    });
  } catch (err) {
    console.error('[Route] POST /review:', err);
    return res.status(500).json({ error: 'Erro ao salvar revisão.' });
  }
});

// ─── PATCH /occurrences/:occurrenceId/description ────────────────────────────
// Update manual description for an occurrence item
router.patch('/:occurrenceId/description', async (req: Request, res: Response) => {
  const { occurrenceId } = req.params;

  try {
    const { occurrenceIndex, description, userId } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'Campo obrigatório: description' });
    }

    const saved = await updateManualDescription(
      occurrenceId,
      occurrenceIndex || 1,
      description,
      userId || 'anonymous',
    );

    if (!saved) {
      return res.status(404).json({ error: 'Ocorrência não encontrada.' });
    }

    return res.status(200).json({ message: 'Descrição atualizada.' });
  } catch (err) {
    console.error('[Route] PATCH /description:', err);
    return res.status(500).json({ error: 'Erro ao atualizar descrição.' });
  }
});

// ─── POST /occurrences/:occurrenceId/submit ───────────────────────────────────
// Submit the complete occurrence record
router.post('/:occurrenceId/submit', async (req: Request, res: Response) => {
  const { occurrenceId } = req.params;

  try {
    const { userId } = req.body;

    const occ = await submitOccurrence(occurrenceId, userId || 'anonymous');

    if (!occ) {
      return res.status(404).json({ error: 'Ocorrência não encontrada.' });
    }

    return res.status(200).json({
      occurrenceId: occ._id,
      status: occ.status,
      requiresOperationalReview: occ.requiresOperationalReview,
      message:
        occ.requiresOperationalReview
          ? 'Registro enviado. Algumas fotos precisam de revisão pela operação.'
          : 'Registro enviado com sucesso.',
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('análises em andamento')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Route] POST /submit:', err);
    return res.status(500).json({ error: 'Erro ao enviar registro.' });
  }
});

// ─── PATCH /occurrences/:occurrenceId/operational-review ─────────────────────
// Operator reviews and decides on an occurrence
router.patch('/:occurrenceId/operational-review', async (req: Request, res: Response) => {
  const { occurrenceId } = req.params;

  try {
    const { operatorId, decision, notes, reclassifiedData } = req.body;

    if (!operatorId || !decision) {
      return res.status(400).json({ error: 'Campos obrigatórios: operatorId, decision' });
    }

    const occ = await saveOperationalReview(occurrenceId, operatorId, decision, notes, reclassifiedData);

    if (!occ) {
      return res.status(404).json({ error: 'Ocorrência não encontrada.' });
    }

    return res.status(200).json({
      occurrenceId: occ._id,
      status: occ.status,
      decision,
      message: 'Revisão operacional salva.',
    });
  } catch (err) {
    console.error('[Route] PATCH /operational-review:', err);
    return res.status(500).json({ error: 'Erro ao salvar revisão operacional.' });
  }
});

// ─── GET /occurrences/:id ────────────────────────────────────────────────────
router.get('/:occurrenceId', async (req: Request, res: Response) => {
  try {
    const occ = await getOccurrenceById(req.params.occurrenceId);
    if (!occ) return res.status(404).json({ error: 'Ocorrência não encontrada.' });
    return res.status(200).json(occ);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar ocorrência.' });
  }
});

// ─── GET /occurrences/reservation/:reservationId ─────────────────────────────
router.get('/reservation/:reservationId', async (req: Request, res: Response) => {
  try {
    const occs = await getOccurrencesByReservation(req.params.reservationId);
    return res.status(200).json({ occurrences: occs, totalCount: occs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar ocorrências.' });
  }
});

// ─── GET /occurrences/vehicle/:vehicleId ──────────────────────────────────────
router.get('/vehicle/:vehicleId', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string || '20', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);
    const occs = await getOccurrencesByVehicle(req.params.vehicleId, limit, offset);
    return res.status(200).json({ occurrences: occs, totalCount: occs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar ocorrências.' });
  }
});

// ─── GET /occurrences/pending-review ─────────────────────────────────────────
router.get('/admin/pending-review', async (_req: Request, res: Response) => {
  try {
    const occs = await getPendingOperationalReview();
    return res.status(200).json({ occurrences: occs, totalCount: occs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar revisões pendentes.' });
  }
});

// ─── Static media files ───────────────────────────────────────────────────────
router.get('/media/:occurrenceId/:filename', (req: Request, res: Response) => {
  const { occurrenceId, filename } = req.params;
  const safeName = path.basename(filename);
  const filePath = path.join(process.cwd(), 'uploads', occurrenceId, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  return res.sendFile(filePath);
});

export default router;
