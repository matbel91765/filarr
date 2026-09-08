/**
 * Générateur d'icônes placeholder pour PWA
 *
 * Génère des icônes temporaires en attendant le design final.
 * Nécessite: npm install sharp
 */

const sharp = require('sharp');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'public');

// Configuration des icônes
const config = {
  background: '#4a90e2', // Couleur principale Filarr
  textColor: '#ffffff',
  letter: 'F', // Initiale Filarr
  sizes: [
    { width: 512, height: 512, name: 'logo512.png' },
    { width: 192, height: 192, name: 'logo192.png' },
    { width: 180, height: 180, name: 'apple-touch-icon.png' },
    { width: 64, height: 64, name: 'favicon-64.png' },
    { width: 32, height: 32, name: 'favicon-32.png' },
    { width: 16, height: 16, name: 'favicon-16.png' },
  ],
};

/**
 * Génère un SVG pour une taille donnée
 */
function generateSVG(size) {
  const fontSize = Math.floor(size * 0.5); // 50% de la taille
  const strokeWidth = Math.max(2, Math.floor(size * 0.03));
  const padding = size * 0.15;

  // Design moderne: Dossier avec "F" et élément de sécurité
  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#4a90e2;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#2c5aa0;stop-opacity:1" />
        </linearGradient>
        <filter id="shadow">
          <feDropShadow dx="0" dy="${size * 0.02}" stdDeviation="${size * 0.01}" flood-opacity="0.3"/>
        </filter>
      </defs>

      <!-- Fond dégradé -->
      <rect width="${size}" height="${size}" fill="url(#grad)" rx="${size * 0.1}"/>

      <!-- Dossier stylisé -->
      <path d="M ${padding} ${padding + size * 0.1}
               L ${padding} ${size - padding * 1.5}
               Q ${padding} ${size - padding} ${padding + size * 0.05} ${size - padding}
               L ${size - padding - size * 0.05} ${size - padding}
               Q ${size - padding} ${size - padding} ${size - padding} ${size - padding * 1.5}
               L ${size - padding} ${padding + size * 0.1}
               Q ${size - padding} ${padding} ${size - padding - size * 0.05} ${padding}
               L ${padding + size * 0.3} ${padding}
               L ${padding + size * 0.25} ${padding - size * 0.05}
               L ${padding + size * 0.05} ${padding}
               Q ${padding} ${padding} ${padding} ${padding + size * 0.1} Z"
            fill="rgba(255,255,255,0.15)"
            filter="url(#shadow)"/>

      <!-- Lettre F -->
      <text x="50%" y="50%"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="Arial, Helvetica, sans-serif"
            font-size="${fontSize}"
            font-weight="700"
            fill="${config.textColor}"
            style="text-shadow: 0 ${strokeWidth}px ${strokeWidth * 2}px rgba(0,0,0,0.3);">
        ${config.letter}
      </text>

      <!-- Élément de sécurité (cadenas simplifié) -->
      <g transform="translate(${size * 0.7}, ${size * 0.7})">
        <circle cx="0" cy="0" r="${size * 0.08}"
                fill="rgba(255,255,255,0.9)"
                stroke="rgba(0,0,0,0.1)"
                stroke-width="${strokeWidth / 2}"/>
        <path d="M ${-size * 0.02} ${-size * 0.02}
                 L ${-size * 0.02} ${size * 0.03}
                 L ${size * 0.02} ${size * 0.03}
                 L ${size * 0.02} ${-size * 0.02} Z"
              fill="#4a90e2"/>
        <circle cx="0" cy="${-size * 0.04}" r="${size * 0.025}"
                fill="none"
                stroke="#4a90e2"
                stroke-width="${strokeWidth / 2}"/>
      </g>
    </svg>
  `.trim();
}

/**
 * Génère toutes les icônes
 */
async function generateIcons() {
  console.log('🎨 Génération des icônes placeholder PWA...\n');

  for (const { width, height, name } of config.sizes) {
    try {
      const svg = generateSVG(width);
      const outputPath = path.join(outputDir, name);

      await sharp(Buffer.from(svg))
        .resize(width, height)
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(outputPath);

      console.log(`✓ ${name} (${width}x${height})`);
    } catch (error) {
      console.error(`✗ Erreur lors de la génération de ${name}:`, error.message);
    }
  }

  console.log('\n📦 Génération des favicon.ico...');
  console.log('⚠️  Pour générer favicon.ico, utilisez ImageMagick:');
  console.log('    convert public/favicon-16.png public/favicon-32.png public/favicon-64.png public/favicon.ico');
  console.log('\nOu utilisez: https://www.favicon-generator.org/\n');

  console.log('✨ Icônes placeholder générées avec succès!');
  console.log('📝 Voir ICONS_TODO.md pour créer les icônes finales professionnelles.\n');
}

// Exécution
if (require.main === module) {
  generateIcons().catch(error => {
    console.error('❌ Erreur:', error);
    process.exit(1);
  });
}

module.exports = { generateIcons };
