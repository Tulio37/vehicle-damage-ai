// ─── Enums ───────────────────────────────────────────────────────────────────

export enum DamageType {
  SCRATCH = 'scratch',
  DENT = 'dent',
  CRACK = 'crack',
  BROKEN = 'broken',
  MISALIGNED = 'misaligned',
  BUMPER = 'bumper_damage',
  HEADLIGHT = 'headlight_damage',
  MIRROR = 'mirror_damage',
  GLASS = 'glass_damage',
  WHEEL = 'wheel_damage',
}

export enum DamageTypeLabel {
  scratch = 'Arranhão / Risco',
  dent = 'Amassado',
  crack = 'Trinca',
  broken = 'Quebra',
  misaligned = 'Peça Desalinhada',
  bumper_damage = 'Dano em Para-choque',
  headlight_damage = 'Dano em Farol / Lanterna',
  mirror_damage = 'Dano em Retrovisor',
  glass_damage = 'Dano em Vidro',
  wheel_damage = 'Dano em Roda / Calota',
}

export enum VehicleSide {
  FRONT = 'front',
  REAR = 'rear',
  LEFT = 'left',
  RIGHT = 'right',
  TOP = 'top',
  UNDERBODY = 'underbody',
}

export enum VehicleSideLabel {
  front = 'Dianteiro',
  rear = 'Traseiro',
  left = 'Lateral Esquerda',
  right = 'Lateral Direita',
  top = 'Teto',
  underbody = 'Parte Inferior',
}

export enum VehiclePart {
  FRONT_BUMPER = 'front_bumper',
  REAR_BUMPER = 'rear_bumper',
  FRONT_LEFT_DOOR = 'front_left_door',
  FRONT_RIGHT_DOOR = 'front_right_door',
  REAR_LEFT_DOOR = 'rear_left_door',
  REAR_RIGHT_DOOR = 'rear_right_door',
  FRONT_LEFT_FENDER = 'front_left_fender',
  FRONT_RIGHT_FENDER = 'front_right_fender',
  REAR_LEFT_FENDER = 'rear_left_fender',
  REAR_RIGHT_FENDER = 'rear_right_fender',
  HOOD = 'hood',
  TRUNK = 'trunk',
  ROOF = 'roof',
  LEFT_MIRROR = 'left_mirror',
  RIGHT_MIRROR = 'right_mirror',
  WINDSHIELD = 'windshield',
  REAR_WINDOW = 'rear_window',
  LEFT_WINDOW = 'left_window',
  RIGHT_WINDOW = 'right_window',
  FRONT_LEFT_WHEEL = 'front_left_wheel',
  FRONT_RIGHT_WHEEL = 'front_right_wheel',
  REAR_LEFT_WHEEL = 'rear_left_wheel',
  REAR_RIGHT_WHEEL = 'rear_right_wheel',
  FRONT_LEFT_HEADLIGHT = 'front_left_headlight',
  FRONT_RIGHT_HEADLIGHT = 'front_right_headlight',
  REAR_LEFT_TAILLIGHT = 'rear_left_taillight',
  REAR_RIGHT_TAILLIGHT = 'rear_right_taillight',
  PILLAR = 'pillar',
  ROCKER_PANEL = 'rocker_panel',
  UNDERBODY = 'underbody',
  MULTIPLE = 'multiple',
  UNKNOWN = 'unknown',
}

export enum Severity {
  LIGHT = 'light',
  MODERATE = 'moderate',
  SEVERE = 'severe',
}

export enum SeverityLabel {
  light = 'Leve',
  moderate = 'Moderado',
  severe = 'Severo',
}

export enum ConfidenceLevel {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum ImageQualityClassification {
  GOOD = 'good',
  POOR = 'poor',
  UNACCEPTABLE = 'unacceptable',
}

export enum AnalysisStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum HumanReviewAction {
  CONFIRMED = 'confirmed',
  CORRECTED = 'corrected',
  DISCARDED = 'discarded',
  KEPT_DESPITE_WARNING = 'kept_despite_warning',
}

export enum OccurrenceStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  PENDING_REVIEW = 'pending_review',
  REVIEWED = 'reviewed',
  CLOSED = 'closed',
}

// ─── AI Analysis Types ────────────────────────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageQualityResult {
  score: number;
  classification: ImageQualityClassification;
  issues: string[];
}

export interface DamageSuggestion {
  damageType: DamageType;
  damageTypeLabel: string;
  vehicleSide: VehicleSide;
  vehicleSideLabel: string;
  vehiclePart: VehiclePart;
  vehiclePartLabel: string;
  severity: Severity;
  severityLabel: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  suggestedDescription: string;
  boundingBox: BoundingBox | null;
  additionalNotes: string;
}

export interface AIAnalysisResult {
  analysisId: string;
  status: AnalysisStatus;
  processedAt: Date;
  processingTimeMs: number;
  modelVersion: string;
  imageQuality: ImageQualityResult;
  vehicleDetected: boolean;
  damageDetected: boolean;
  suggestion: DamageSuggestion | null;
  requiresRetake: boolean;
  requiresOperationalReview: boolean;
  userFacingMessage: string;
  retakeGuidance: string | null;
}

// ─── Human Review Types ───────────────────────────────────────────────────────

export interface HumanReview {
  action: HumanReviewAction;
  reviewedAt: Date;
  reviewedBy: string;
  reviewerType: 'customer' | 'operator';
  correctedDescription?: string;
  correctedDamageType?: DamageType;
  correctedVehiclePart?: VehiclePart;
  correctedSeverity?: Severity;
  notes?: string;
}

// ─── Request / Response Types ─────────────────────────────────────────────────

export interface UploadMediaResponse {
  mediaId: string;
  occurrenceId: string;
  uploadedUrl: string;
  thumbnailUrl: string;
  analysisStatus: AnalysisStatus;
  message: string;
}

export interface HumanReviewRequest {
  action: HumanReviewAction;
  correctedData?: {
    damageType?: DamageType;
    vehiclePart?: VehiclePart;
    severity?: Severity;
    description?: string;
  };
  notes?: string;
}

export interface SaveOccurrenceRequest {
  vehicleId: string;
  reservationId: string;
  userId: string;
  plate: string;
  vehicleModel: string;
  occurrences: Array<{
    occurrenceIndex: number;
    manualDescription: string;
    mediaIds: string[];
  }>;
}
