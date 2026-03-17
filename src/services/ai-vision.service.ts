import Groq from 'groq-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  AIAnalysisResult,
  AnalysisStatus,
  ConfidenceLevel,
  DamageSuggestion,
  DamageType,
  DamageTypeLabel,
  ImageQualityClassification,
  Severity,
  SeverityLabel,
  VehiclePart,
  VehicleSide,
  VehicleSideLabel,
} from '../types';

const MODEL_VERSION = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um especialista em avaliação de avarias em veículos de uma locadora de automóveis.
Sua função é analisar imagens de veículos enviadas por clientes e pela operação da locadora,
identificar possíveis avarias visíveis e retornar uma análise estruturada em JSON.

REGRAS FUNDAMENTAIS:
- Você é um ASSISTENTE de análise, não uma autoridade final. Suas sugestões sempre passam por confirmação humana.
- Seja conservador: prefira reportar incerteza a fazer afirmações falsas com alta confiança.
- Diferencie claramente sujeira, reflexo e sombra de danos reais.
- Se a foto não tiver qualidade suficiente, priorize orientar o usuário sobre como melhorar a captura.
- Sempre responda em português do Brasil nos campos de texto voltados ao usuário.
- Retorne APENAS o JSON estruturado, sem texto adicional antes ou depois.`;

const buildAnalysisPrompt = (): string => `Analise esta imagem de um veículo de locadora e retorne um JSON com a seguinte estrutura exata.

AVALIAÇÃO OBRIGATÓRIA (responda todos os campos):

{
  "imageQuality": {
    "score": <número de 0 a 100>,
    "classification": <"good" | "poor" | "unacceptable">,
    "issues": <array de strings com problemas encontrados, ex: ["dark", "blurry", "too_far", "no_vehicle", "reflections"]>
  },
  "vehicleDetected": <true | false>,
  "damageDetected": <true | false>,
  "suggestion": <null se não há dano ou confiança muito baixa, ou objeto abaixo>,
  "requiresRetake": <true | false>,
  "requiresOperationalReview": <true | false>,
  "userFacingMessage": "<mensagem clara em português para o usuário final, max 120 chars>",
  "retakeGuidance": <null ou string com orientação específica de como refazer a foto>
}

SE suggestion não for null, use este formato:
{
  "damageType": <"scratch" | "dent" | "crack" | "broken" | "misaligned" | "bumper_damage" | "headlight_damage" | "mirror_damage" | "glass_damage" | "wheel_damage">,
  "vehicleSide": <"front" | "rear" | "left" | "right" | "top" | "underbody">,
  "vehiclePart": <"front_bumper" | "rear_bumper" | "front_left_door" | "front_right_door" | "rear_left_door" | "rear_right_door" | "front_left_fender" | "front_right_fender" | "rear_left_fender" | "rear_right_fender" | "hood" | "trunk" | "roof" | "left_mirror" | "right_mirror" | "windshield" | "rear_window" | "left_window" | "right_window" | "front_left_wheel" | "front_right_wheel" | "rear_left_wheel" | "rear_right_wheel" | "front_left_headlight" | "front_right_headlight" | "rear_left_taillight" | "rear_right_taillight" | "pillar" | "rocker_panel" | "underbody" | "multiple" | "unknown">,
  "severity": <"light" | "moderate" | "severe">,
  "confidence": <número de 0.0 a 1.0>,
  "suggestedDescription": "<descrição curta e clara da avaria em português, max 120 chars>",
  "boundingBox": <null ou {"x": <int>, "y": <int>, "width": <int>, "height": <int>} em pixels relativos à imagem>,
  "additionalNotes": "<observações adicionais relevantes para a operação, em português>"
}

CRITÉRIOS DE QUALIDADE:
- score >= 70 = "good"
- score 40-69 = "poor" (análise possível mas imprecisa)
- score < 40 = "unacceptable" (não é possível analisar)
- requiresRetake = true quando score < 50 OU vehicleDetected = false
- requiresOperationalReview = true quando: confiança < 0.4 OU score < 50 OU severity = "severe"

CRITÉRIOS DE CONFIANÇA:
- 0.75-1.0 = dano claramente visível, tipo e local identificáveis com certeza
- 0.40-0.74 = dano provável mas com alguma ambiguidade (reflexo, ângulo, distância)
- 0.0-0.39 = muito incerto — não retorne suggestion, retorne null

Retorne APENAS o JSON, sem markdown, sem texto adicional.`;

// ─── Label Maps ───────────────────────────────────────────────────────────────

const VEHICLE_PART_LABELS: Record<string, string> = {
  front_bumper: 'Para-choque dianteiro',
  rear_bumper: 'Para-choque traseiro',
  front_left_door: 'Porta dianteira esquerda',
  front_right_door: 'Porta dianteira direita',
  rear_left_door: 'Porta traseira esquerda',
  rear_right_door: 'Porta traseira direita',
  front_left_fender: 'Paralama dianteiro esquerdo',
  front_right_fender: 'Paralama dianteiro direito',
  rear_left_fender: 'Paralama traseiro esquerdo',
  rear_right_fender: 'Paralama traseiro direito',
  hood: 'Capô',
  trunk: 'Tampa do porta-malas',
  roof: 'Teto',
  left_mirror: 'Retrovisor esquerdo',
  right_mirror: 'Retrovisor direito',
  windshield: 'Para-brisa',
  rear_window: 'Vidro traseiro',
  left_window: 'Vidro lateral esquerdo',
  right_window: 'Vidro lateral direito',
  front_left_wheel: 'Roda dianteira esquerda',
  front_right_wheel: 'Roda dianteira direita',
  rear_left_wheel: 'Roda traseira esquerda',
  rear_right_wheel: 'Roda traseira direita',
  front_left_headlight: 'Farol dianteiro esquerdo',
  front_right_headlight: 'Farol dianteiro direito',
  rear_left_taillight: 'Lanterna traseira esquerda',
  rear_right_taillight: 'Lanterna traseira direita',
  pillar: 'Coluna',
  rocker_panel: 'Soleira',
  underbody: 'Parte inferior',
  multiple: 'Múltiplas áreas',
  unknown: 'Local indeterminado',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.75) return ConfidenceLevel.HIGH;
  if (confidence >= 0.40) return ConfidenceLevel.MEDIUM;
  return ConfidenceLevel.LOW;
}

function getImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[ext] || 'image/jpeg';
}

// ─── Parse AI Response ────────────────────────────────────────────────────────

interface RawAIResponse {
  imageQuality: { score: number; classification: string; issues: string[] };
  vehicleDetected: boolean;
  damageDetected: boolean;
  suggestion: {
    damageType: string;
    vehicleSide: string;
    vehiclePart: string;
    severity: string;
    confidence: number;
    suggestedDescription: string;
    boundingBox: { x: number; y: number; width: number; height: number } | null;
    additionalNotes: string;
  } | null;
  requiresRetake: boolean;
  requiresOperationalReview: boolean;
  userFacingMessage: string;
  retakeGuidance: string | null;
}

function parseAIResponse(raw: RawAIResponse, analysisId: string, startTime: number): AIAnalysisResult {
  const processingTimeMs = Date.now() - startTime;
  let suggestion: DamageSuggestion | null = null;

  if (raw.suggestion && raw.damageDetected) {
    const confidence = Math.min(1, Math.max(0, raw.suggestion.confidence));
    const damageType = raw.suggestion.damageType as DamageType;
    const vehicleSide = raw.suggestion.vehicleSide as VehicleSide;
    const vehiclePart = raw.suggestion.vehiclePart as VehiclePart;
    const severity = raw.suggestion.severity as Severity;

    suggestion = {
      damageType,
      damageTypeLabel: DamageTypeLabel[damageType] || raw.suggestion.damageType,
      vehicleSide,
      vehicleSideLabel: VehicleSideLabel[vehicleSide] || raw.suggestion.vehicleSide,
      vehiclePart,
      vehiclePartLabel: VEHICLE_PART_LABELS[vehiclePart] || raw.suggestion.vehiclePart,
      severity,
      severityLabel: SeverityLabel[severity] || raw.suggestion.severity,
      confidence,
      confidenceLevel: getConfidenceLevel(confidence),
      suggestedDescription: raw.suggestion.suggestedDescription,
      boundingBox: raw.suggestion.boundingBox,
      additionalNotes: raw.suggestion.additionalNotes,
    };
  }

  return {
    analysisId,
    status: AnalysisStatus.COMPLETED,
    processedAt: new Date(),
    processingTimeMs,
    modelVersion: MODEL_VERSION,
    imageQuality: {
      score: raw.imageQuality.score,
      classification: raw.imageQuality.classification as ImageQualityClassification,
      issues: raw.imageQuality.issues,
    },
    vehicleDetected: raw.vehicleDetected,
    damageDetected: raw.damageDetected,
    suggestion,
    requiresRetake: raw.requiresRetake,
    requiresOperationalReview: raw.requiresOperationalReview,
    userFacingMessage: raw.userFacingMessage,
    retakeGuidance: raw.retakeGuidance,
  };
}

// ─── Mock Mode ────────────────────────────────────────────────────────────────

const MOCK_RESULTS: RawAIResponse[] = [
  {
    imageQuality: { score: 82, classification: 'good', issues: [] },
    vehicleDetected: true,
    damageDetected: true,
    suggestion: {
      damageType: 'scratch',
      vehicleSide: 'left',
      vehiclePart: 'front_left_door',
      severity: 'light',
      confidence: 0.81,
      suggestedDescription: 'Arranhão leve na porta dianteira esquerda.',
      boundingBox: { x: 120, y: 200, width: 80, height: 30 },
      additionalNotes: 'Arranhão superficial, sem comprometimento da pintura base.',
    },
    requiresRetake: false,
    requiresOperationalReview: false,
    userFacingMessage: 'Possível arranhão leve na porta dianteira esquerda. Confirme se está correto.',
    retakeGuidance: null,
  },
  {
    imageQuality: { score: 75, classification: 'good', issues: [] },
    vehicleDetected: true,
    damageDetected: true,
    suggestion: {
      damageType: 'dent',
      vehicleSide: 'rear',
      vehiclePart: 'rear_bumper',
      severity: 'moderate',
      confidence: 0.73,
      suggestedDescription: 'Amassado moderado no para-choque traseiro.',
      boundingBox: { x: 80, y: 310, width: 200, height: 90 },
      additionalNotes: 'Amassado com possível necessidade de reparo.',
    },
    requiresRetake: false,
    requiresOperationalReview: true,
    userFacingMessage: 'Amassado moderado detectado no para-choque traseiro. Confiança alta.',
    retakeGuidance: null,
  },
  {
    imageQuality: { score: 90, classification: 'good', issues: [] },
    vehicleDetected: true,
    damageDetected: false,
    suggestion: null,
    requiresRetake: false,
    requiresOperationalReview: false,
    userFacingMessage: 'Não identificamos avarias visíveis nesta foto.',
    retakeGuidance: null,
  },
  {
    imageQuality: { score: 45, classification: 'poor', issues: ['dark', 'blurry'] },
    vehicleDetected: true,
    damageDetected: false,
    suggestion: null,
    requiresRetake: true,
    requiresOperationalReview: false,
    userFacingMessage: 'Foto com qualidade reduzida. Recomendamos refazer com mais luz.',
    retakeGuidance: 'Aproxime-se do veículo e tire a foto em local bem iluminado.',
  },
];

let _mockIndex = 0;

async function analyzeVehicleDamageMock(analysisId: string, startTime: number): Promise<AIAnalysisResult> {
  const raw = MOCK_RESULTS[_mockIndex % MOCK_RESULTS.length];
  _mockIndex++;
  await new Promise((r) => setTimeout(r, 3000));
  return parseAIResponse(raw, analysisId, startTime);
}

function isMockMode(): boolean {
  if (process.env.MOCK_MODE === 'true') return true;
  const key = process.env.GROQ_API_KEY || '';
  return !key || key.length < 20;
}

// ─── Main Analysis Function ───────────────────────────────────────────────────

export async function analyzeVehicleDamage(imagePath: string): Promise<AIAnalysisResult> {
  const analysisId = uuidv4();
  const startTime = Date.now();

  if (isMockMode()) {
    console.log('[AI Vision] Modo mock ativo. Retornando resultado simulado.');
    return analyzeVehicleDamageMock(analysisId, startTime);
  }

  let imageBase64: string;
  let mimeType: string;

  try {
    const imageBuffer = fs.readFileSync(imagePath);
    imageBase64 = imageBuffer.toString('base64');
    mimeType = getImageMimeType(imagePath);
  } catch {
    return {
      analysisId,
      status: AnalysisStatus.FAILED,
      processedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
      modelVersion: MODEL_VERSION,
      imageQuality: { score: 0, classification: ImageQualityClassification.UNACCEPTABLE, issues: ['file_read_error'] },
      vehicleDetected: false,
      damageDetected: false,
      suggestion: null,
      requiresRetake: true,
      requiresOperationalReview: true,
      userFacingMessage: 'Não foi possível processar a imagem. Tente novamente.',
      retakeGuidance: 'Tire uma nova foto e tente enviar novamente.',
    };
  }

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groq.chat.completions.create({
      model: MODEL_VERSION,
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
            {
              type: 'text',
              text: buildAnalysisPrompt(),
            },
          ],
        },
      ],
    });

    let rawText = completion.choices[0]?.message?.content?.trim() ?? '';

    // Remove markdown code blocks if present
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    console.log('[AI Vision] Resposta Groq:', rawText.substring(0, 200));

    const raw: RawAIResponse = JSON.parse(rawText);
    return parseAIResponse(raw, analysisId, startTime);

  } catch (err) {
    console.error('[AI Vision] Erro na análise Groq:', err);

    return {
      analysisId,
      status: AnalysisStatus.FAILED,
      processedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
      modelVersion: MODEL_VERSION,
      imageQuality: { score: 0, classification: ImageQualityClassification.UNACCEPTABLE, issues: ['analysis_error'] },
      vehicleDetected: false,
      damageDetected: false,
      suggestion: null,
      requiresRetake: false,
      requiresOperationalReview: true,
      userFacingMessage: 'Não foi possível analisar esta foto. Descreva manualmente o que você observou.',
      retakeGuidance: null,
    };
  }
}
