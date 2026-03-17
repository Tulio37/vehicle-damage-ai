import mongoose, { Document, Schema } from 'mongoose';
import {
  AnalysisStatus,
  ConfidenceLevel,
  DamageType,
  HumanReviewAction,
  ImageQualityClassification,
  OccurrenceStatus,
  Severity,
  VehiclePart,
  VehicleSide,
} from '../types';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const BoundingBoxSchema = new Schema({
  x: Number,
  y: Number,
  width: Number,
  height: Number,
}, { _id: false });

const ImageQualitySchema = new Schema({
  score: { type: Number, min: 0, max: 100 },
  classification: { type: String, enum: Object.values(ImageQualityClassification) },
  issues: [String],
}, { _id: false });

const DamageSuggestionSchema = new Schema({
  damageType: { type: String, enum: Object.values(DamageType) },
  damageTypeLabel: String,
  vehicleSide: { type: String, enum: Object.values(VehicleSide) },
  vehicleSideLabel: String,
  vehiclePart: { type: String, enum: Object.values(VehiclePart) },
  vehiclePartLabel: String,
  severity: { type: String, enum: Object.values(Severity) },
  severityLabel: String,
  confidence: { type: Number, min: 0, max: 1 },
  confidenceLevel: { type: String, enum: Object.values(ConfidenceLevel) },
  suggestedDescription: String,
  boundingBox: BoundingBoxSchema,
  additionalNotes: String,
}, { _id: false });

const AIAnalysisSchema = new Schema({
  analysisId: { type: String, required: true },
  status: { type: String, enum: Object.values(AnalysisStatus), default: AnalysisStatus.QUEUED },
  processedAt: Date,
  processingTimeMs: Number,
  modelVersion: String,
  imageQuality: ImageQualitySchema,
  vehicleDetected: Boolean,
  damageDetected: Boolean,
  suggestion: DamageSuggestionSchema,
  requiresRetake: Boolean,
  requiresOperationalReview: Boolean,
  userFacingMessage: String,
  retakeGuidance: String,
}, { _id: false });

const HumanReviewSchema = new Schema({
  action: { type: String, enum: Object.values(HumanReviewAction) },
  reviewedAt: Date,
  reviewedBy: String,
  reviewerType: { type: String, enum: ['customer', 'operator'] },
  correctedDescription: String,
  correctedDamageType: { type: String, enum: [...Object.values(DamageType), null] },
  correctedVehiclePart: { type: String, enum: [...Object.values(VehiclePart), null] },
  correctedSeverity: { type: String, enum: [...Object.values(Severity), null] },
  notes: String,
}, { _id: false });

const MediaSchema = new Schema({
  mediaId: { type: String, required: true },
  mediaIndex: { type: Number, required: true },
  type: { type: String, enum: ['photo', 'video'], default: 'photo' },
  originalUrl: String,
  thumbnailUrl: String,
  uploadedAt: { type: Date, default: Date.now },
  fileSizeBytes: Number,
  mimeType: String,
  aiAnalysis: AIAnalysisSchema,
  humanReview: HumanReviewSchema,
}, { _id: false });

const OccurrenceItemSchema = new Schema({
  occurrenceIndex: { type: Number, required: true },
  manualDescription: { type: String, maxlength: 250 },
  status: { type: String, enum: Object.values(OccurrenceStatus), default: OccurrenceStatus.DRAFT },
  requiresReview: { type: Boolean, default: false },
  media: [MediaSchema],
}, { _id: false });

const AuditEventSchema = new Schema({
  event: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  actorId: String,
  actorType: { type: String, enum: ['customer', 'operator', 'system', 'ai'] },
  details: Schema.Types.Mixed,
}, { _id: false });

const OperationalReviewSchema = new Schema({
  required: { type: Boolean, default: false },
  reviewedAt: Date,
  reviewedBy: String,
  decision: { type: String, enum: ['accepted', 'rejected', 'reclassified', null] },
  notes: String,
  reclassifiedData: Schema.Types.Mixed,
}, { _id: false });

// ─── Main Occurrence Schema ───────────────────────────────────────────────────

export interface IOccurrenceDocument extends Document {
  vehicleId: string;
  reservationId: string;
  userId: string;
  plate: string;
  vehicleModel: string;
  status: OccurrenceStatus;
  requiresOperationalReview: boolean;
  occurrences: Array<{
    occurrenceIndex: number;
    manualDescription: string;
    status: OccurrenceStatus;
    requiresReview: boolean;
    media: Array<{
      mediaId: string;
      mediaIndex: number;
      type: string;
      originalUrl: string;
      thumbnailUrl: string;
      uploadedAt: Date;
      fileSizeBytes: number;
      mimeType: string;
      aiAnalysis?: {
        analysisId: string;
        status: AnalysisStatus;
        processedAt?: Date;
        processingTimeMs?: number;
        modelVersion?: string;
        imageQuality?: {
          score: number;
          classification: string;
          issues: string[];
        };
        vehicleDetected?: boolean;
        damageDetected?: boolean;
        suggestion?: Record<string, unknown> | null;
        requiresRetake?: boolean;
        requiresOperationalReview?: boolean;
        userFacingMessage?: string;
        retakeGuidance?: string | null;
      };
      humanReview?: {
        action: HumanReviewAction;
        reviewedAt: Date;
        reviewedBy: string;
        reviewerType: string;
        correctedDescription?: string;
        notes?: string;
      };
    }>;
  }>;
  operationalReview: {
    required: boolean;
    reviewedAt?: Date;
    reviewedBy?: string;
    decision?: string | null;
    notes?: string;
    reclassifiedData?: Record<string, unknown>;
  };
  audit: Array<{
    event: string;
    timestamp: Date;
    actorId: string;
    actorType: string;
    details?: Record<string, unknown>;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const OccurrenceSchema = new Schema<IOccurrenceDocument>(
  {
    vehicleId: { type: String, required: true, index: true },
    reservationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    plate: { type: String, required: true },
    vehicleModel: { type: String },
    status: { type: String, enum: Object.values(OccurrenceStatus), default: OccurrenceStatus.DRAFT },
    requiresOperationalReview: { type: Boolean, default: false },
    occurrences: [OccurrenceItemSchema],
    operationalReview: { type: OperationalReviewSchema, default: () => ({ required: false }) },
    audit: [AuditEventSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for common queries
OccurrenceSchema.index({ reservationId: 1, status: 1 });
OccurrenceSchema.index({ vehicleId: 1, createdAt: -1 });
OccurrenceSchema.index({ requiresOperationalReview: 1, status: 1 });

export const OccurrenceModel = mongoose.model<IOccurrenceDocument>('Occurrence', OccurrenceSchema);
