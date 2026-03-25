import { v4 as uuidv4 } from 'uuid';
import { OccurrenceModel, IOccurrenceDocument } from '../models/occurrence.model';
import { analyzeVehicleDamage } from './ai-vision.service';
import { saveMediaFile, getLocalPath } from './storage.service';
import {
  AnalysisStatus,
  HumanReviewAction,
  HumanReviewRequest,
  OccurrenceStatus,
  SaveOccurrenceRequest,
} from '../types';

// ─── Create / Upsert Occurrence Record ───────────────────────────────────────

export async function getOrCreateOccurrence(
  reservationId: string,
  vehicleId: string,
  userId: string,
  plate: string,
  vehicleModel: string,
): Promise<IOccurrenceDocument> {
  let occ = await OccurrenceModel.findOne({
    reservationId,
    status: { $in: [OccurrenceStatus.DRAFT] },
  });

  if (!occ) {
    occ = new OccurrenceModel({
      vehicleId,
      reservationId,
      userId,
      plate,
      vehicleModel,
      status: OccurrenceStatus.DRAFT,
      occurrences: [],
      audit: [
        {
          event: 'occurrence_created',
          timestamp: new Date(),
          actorId: userId,
          actorType: 'customer',
          details: {},
        },
      ],
    });
    await occ.save();
  }

  return occ;
}

// ─── Upload Media + Trigger Analysis ─────────────────────────────────────────

export async function uploadAndAnalyzeMedia(params: {
  occurrenceId: string;
  occurrenceIndex: number;
  mediaIndex: number;
  tempFilePath: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  userId: string;
}): Promise<{ mediaId: string; analysisId: string }> {
  const {
    occurrenceId,
    occurrenceIndex,
    mediaIndex,
    tempFilePath,
    mimeType,
    fileSizeBytes,
    userId,
  } = params;

  const mediaId = uuidv4();
  const analysisId = uuidv4();

  // Save file to storage
  const stored = await saveMediaFile(tempFilePath, mediaId, occurrenceId, mimeType);

  // Find or create occurrence document
  let occ = await OccurrenceModel.findById(occurrenceId);
  if (!occ) {
    throw new Error(`Ocorrência não encontrada: ${occurrenceId}`);
  }

  // Find or create occurrence item
  let occItem = occ.occurrences.find((o) => o.occurrenceIndex === occurrenceIndex);
  if (!occItem) {
    occ.occurrences.push({
      occurrenceIndex,
      manualDescription: '',
      status: OccurrenceStatus.DRAFT,
      requiresReview: false,
      media: [],
    });
    occItem = occ.occurrences.find((o) => o.occurrenceIndex === occurrenceIndex)!;
  }

  // Add media entry with QUEUED analysis status
  occItem.media.push({
    mediaId,
    mediaIndex,
    type: 'photo',
    originalUrl: stored.originalUrl,
    thumbnailUrl: stored.thumbnailUrl,
    uploadedAt: new Date(),
    fileSizeBytes,
    mimeType,
    aiAnalysis: {
      analysisId,
      status: AnalysisStatus.QUEUED,
    },
  });

  occ.audit.push({
    event: 'media_uploaded',
    timestamp: new Date(),
    actorId: userId,
    actorType: 'customer',
    details: { mediaId, occurrenceIndex, mediaIndex },
  });

  await occ.save();

  // ── Run analysis asynchronously (non-blocking) ────────────────────────────
  setImmediate(async () => {
    try {
      // Mark as processing
      await OccurrenceModel.updateOne(
        { _id: occurrenceId, 'occurrences.occurrenceIndex': occurrenceIndex, 'occurrences.media.mediaId': mediaId },
        {
          $set: {
            'occurrences.$[occ].media.$[med].aiAnalysis.status': AnalysisStatus.PROCESSING,
          },
        },
        {
          arrayFilters: [
            { 'occ.occurrenceIndex': occurrenceIndex },
            { 'med.mediaId': mediaId },
          ],
        }
      );

      // Call Claude
      const result = await analyzeVehicleDamage(stored.localPath);

      // Persist result
      await OccurrenceModel.updateOne(
        { _id: occurrenceId },
        {
          $set: {
            'occurrences.$[occ].media.$[med].aiAnalysis': {
              ...result,
            },
            'occurrences.$[occ].requiresReview': result.requiresOperationalReview,
          },
          $push: {
            audit: {
              event: 'ai_analysis_completed',
              timestamp: new Date(),
              actorId: 'system',
              actorType: 'ai',
              details: {
                mediaId,
                analysisId: result.analysisId,
                damageDetected: result.damageDetected,
                requiresRetake: result.requiresRetake,
                confidence: result.suggestion?.confidence ?? null,
              },
            },
          },
        },
        {
          arrayFilters: [
            { 'occ.occurrenceIndex': occurrenceIndex },
            { 'med.mediaId': mediaId },
          ],
        }
      );

      // If requires operational review, flag the whole occurrence
      if (result.requiresOperationalReview) {
        await OccurrenceModel.updateOne(
          { _id: occurrenceId },
          { $set: { requiresOperationalReview: true } }
        );
      }

    } catch (err) {
      console.error(`[OccurrenceService] Análise falhou para mediaId ${mediaId}:`, err);

      await OccurrenceModel.updateOne(
        { _id: occurrenceId },
        {
          $set: {
            'occurrences.$[occ].media.$[med].aiAnalysis.status': AnalysisStatus.FAILED,
            'occurrences.$[occ].media.$[med].aiAnalysis.userFacingMessage':
              'Análise automática falhou. Descreva a avaria manualmente.',
            requiresOperationalReview: true,
          },
        },
        {
          arrayFilters: [
            { 'occ.occurrenceIndex': occurrenceIndex },
            { 'med.mediaId': mediaId },
          ],
        }
      );
    }
  });

  return { mediaId, analysisId };
}

// ─── Get Analysis Result ──────────────────────────────────────────────────────

export async function getAnalysisResult(occurrenceId: string, mediaId: string) {
  const occ = await OccurrenceModel.findById(occurrenceId);
  if (!occ) return null;

  for (const occItem of occ.occurrences) {
    const media = occItem.media.find((m) => m.mediaId === mediaId);
    if (media) {
      return media.aiAnalysis ?? null;
    }
  }
  return null;
}

// ─── Save Human Review ────────────────────────────────────────────────────────

export async function saveHumanReview(
  occurrenceId: string,
  mediaId: string,
  occurrenceIndex: number,
  reviewData: HumanReviewRequest,
  userId: string,
): Promise<boolean> {
  const humanReview = {
    action: reviewData.action,
    reviewedAt: new Date(),
    reviewedBy: userId,
    reviewerType: 'customer' as const,
    correctedDescription: reviewData.correctedData?.description,
    correctedDamageType: reviewData.correctedData?.damageType,
    correctedVehiclePart: reviewData.correctedData?.vehiclePart,
    correctedSeverity: reviewData.correctedData?.severity,
    notes: reviewData.notes,
  };

  const result = await OccurrenceModel.updateOne(
    { _id: occurrenceId },
    {
      $set: {
        'occurrences.$[occ].media.$[med].humanReview': humanReview,
      },
      $push: {
        audit: {
          event: 'human_review_saved',
          timestamp: new Date(),
          actorId: userId,
          actorType: 'customer',
          details: {
            mediaId,
            action: reviewData.action,
            correctedData: reviewData.correctedData ?? null,
          },
        },
      },
    },
    {
      arrayFilters: [
        { 'occ.occurrenceIndex': occurrenceIndex },
        { 'med.mediaId': mediaId },
      ],
    }
  );

  return result.modifiedCount > 0;
}

// ─── Update Manual Description ────────────────────────────────────────────────

export async function updateManualDescription(
  occurrenceId: string,
  occurrenceIndex: number,
  description: string,
  userId: string,
): Promise<boolean> {
  const result = await OccurrenceModel.updateOne(
    { _id: occurrenceId, 'occurrences.occurrenceIndex': occurrenceIndex },
    {
      $set: { 'occurrences.$[occ].manualDescription': description },
      $push: {
        audit: {
          event: 'description_updated',
          timestamp: new Date(),
          actorId: userId,
          actorType: 'customer',
          details: { occurrenceIndex },
        },
      },
    },
    { arrayFilters: [{ 'occ.occurrenceIndex': occurrenceIndex }] }
  );

  return result.modifiedCount > 0;
}

// ─── Submit Occurrence ────────────────────────────────────────────────────────

export async function submitOccurrence(
  occurrenceId: string,
  userId: string,
): Promise<IOccurrenceDocument | null> {
  const occ = await OccurrenceModel.findById(occurrenceId);
  if (!occ) return null;

  // Check for any pending analysis
  const hasPendingAnalysis = occ.occurrences.some((o) =>
    o.media.some(
      (m) =>
        m.aiAnalysis?.status === AnalysisStatus.QUEUED ||
        m.aiAnalysis?.status === AnalysisStatus.PROCESSING,
    ),
  );

  if (hasPendingAnalysis) {
    throw new Error('Existem análises em andamento. Aguarde antes de enviar.');
  }

  const requiresReview = occ.occurrences.some((o) => o.requiresReview) || occ.requiresOperationalReview;

  occ.status = OccurrenceStatus.SUBMITTED;
  if (requiresReview) {
    occ.status = OccurrenceStatus.PENDING_REVIEW;
    occ.operationalReview.required = true;
  }

  occ.audit.push({
    event: 'occurrence_submitted',
    timestamp: new Date(),
    actorId: userId,
    actorType: 'customer',
    details: { requiresReview },
  });

  await occ.save();
  return occ;
}

// ─── Operational Review ───────────────────────────────────────────────────────

export async function saveOperationalReview(
  occurrenceId: string,
  operatorId: string,
  decision: 'accepted' | 'rejected' | 'reclassified',
  notes?: string,
  reclassifiedData?: Record<string, unknown>,
): Promise<IOccurrenceDocument | null> {
  const occ = await OccurrenceModel.findById(occurrenceId);
  if (!occ) return null;

  occ.operationalReview = {
    required: true,
    reviewedAt: new Date(),
    reviewedBy: operatorId,
    decision,
    notes,
    reclassifiedData,
  };

  occ.status = OccurrenceStatus.REVIEWED;

  occ.audit.push({
    event: 'operational_review_saved',
    timestamp: new Date(),
    actorId: operatorId,
    actorType: 'operator',
    details: { decision, notes },
  });

  await occ.save();
  return occ;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getOccurrencesByReservation(reservationId: string) {
  return OccurrenceModel.find({ reservationId }).sort({ createdAt: -1 });
}

export async function getOccurrencesByVehicle(vehicleId: string, limit = 20, offset = 0) {
  return OccurrenceModel.find({ vehicleId })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit);
}

export async function getPendingOperationalReview(limit = 50) {
  return OccurrenceModel.find({
    requiresOperationalReview: true,
    status: OccurrenceStatus.PENDING_REVIEW,
  })
    .sort({ createdAt: -1 })
    .limit(limit);
}

export async function getOccurrenceById(occurrenceId: string) {
  return OccurrenceModel.findById(occurrenceId);
}

export async function getAllOccurrencesAdmin(limit = 100) {
  return OccurrenceModel.find({})
    .sort({ createdAt: -1 })
    .limit(limit);
}
