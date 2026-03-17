/**
 * Script de teste rápido da análise de IA.
 * Uso: npx tsx test-analysis.ts <caminho-da-foto>
 * Exemplo: npx tsx test-analysis.ts ~/foto-carro.jpg
 */
import 'dotenv/config';
import { analyzeVehicleDamage } from './src/services/ai-vision.service';

const imagePath = process.argv[2];

if (!imagePath) {
  console.error('Uso: npx tsx test-analysis.ts <caminho-da-foto>');
  process.exit(1);
}

console.log(`\n🔍 Analisando imagem: ${imagePath}\n`);
console.log('Aguarde, chamando Claude API...\n');

analyzeVehicleDamage(imagePath).then((result) => {
  console.log('═══════════════════════════════════════════════');
  console.log('📊 RESULTADO DA ANÁLISE');
  console.log('═══════════════════════════════════════════════');
  console.log(`Status:             ${result.status}`);
  console.log(`Tempo de análise:   ${result.processingTimeMs}ms`);
  console.log(`Modelo:             ${result.modelVersion}`);
  console.log('───────────────────────────────────────────────');
  console.log(`Qualidade da foto:  ${result.imageQuality.classification} (score: ${result.imageQuality.score})`);
  if (result.imageQuality.issues.length > 0) {
    console.log(`Problemas:          ${result.imageQuality.issues.join(', ')}`);
  }
  console.log(`Veículo detectado:  ${result.vehicleDetected ? '✅ Sim' : '❌ Não'}`);
  console.log(`Avaria detectada:   ${result.damageDetected ? '⚠️  Sim' : '✅ Não detectada'}`);
  console.log('───────────────────────────────────────────────');

  if (result.suggestion) {
    const s = result.suggestion;
    console.log(`Tipo de dano:       ${s.damageTypeLabel}`);
    console.log(`Local:              ${s.vehiclePartLabel} — ${s.vehicleSideLabel}`);
    console.log(`Gravidade:          ${s.severityLabel}`);
    console.log(`Confiança:          ${(s.confidence * 100).toFixed(0)}% (${s.confidenceLevel})`);
    console.log(`Descrição sugerida: ${s.suggestedDescription}`);
    if (s.boundingBox) {
      const b = s.boundingBox;
      console.log(`Bounding box:       x:${b.x} y:${b.y} w:${b.width} h:${b.height}`);
    }
    if (s.additionalNotes) {
      console.log(`Observações:        ${s.additionalNotes}`);
    }
  }

  console.log('───────────────────────────────────────────────');
  console.log(`💬 Mensagem p/ usuário: "${result.userFacingMessage}"`);
  if (result.retakeGuidance) {
    console.log(`📸 Orientação de retomada: "${result.retakeGuidance}"`);
  }
  console.log(`🔎 Requer revisão operacional: ${result.requiresOperationalReview ? '✅ Sim' : 'Não'}`);
  console.log(`🔄 Requer nova foto: ${result.requiresRetake ? '✅ Sim' : 'Não'}`);
  console.log('═══════════════════════════════════════════════\n');
}).catch((err) => {
  console.error('Erro na análise:', err);
  process.exit(1);
});
