/**
 * Script pour exécuter les tests et générer un rapport de couverture
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Créer le dossier coverage s'il n'existe pas
const coverageDir = path.join(__dirname, '..', 'coverage');
if (!fs.existsSync(coverageDir)) {
  fs.mkdirSync(coverageDir, { recursive: true });
}

// Exécuter les tests avec couverture
console.log('Exécution des tests avec couverture...');
try {
  execSync('npm run test:ci', { stdio: 'inherit' });
} catch (error) {
  console.error('Erreur lors de l\'exécution des tests:', error);
  process.exit(1);
}

// Vérifier si le rapport de couverture a été généré
const coverageReportDir = path.join(coverageDir, 'lcov-report');
if (fs.existsSync(coverageReportDir)) {
  console.log(`Rapport de couverture généré avec succès dans ${coverageReportDir}`);
  console.log('Vous pouvez ouvrir le rapport dans votre navigateur en ouvrant le fichier index.html');
  
  // Afficher un résumé de la couverture
  const coverageSummaryPath = path.join(coverageDir, 'coverage-summary.json');
  if (fs.existsSync(coverageSummaryPath)) {
    const summary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
    const total = summary.total;
    
    console.log('\nRésumé de la couverture:');
    console.log(`Lignes: ${total.lines.pct.toFixed(2)}%`);
    console.log(`Fonctions: ${total.functions.pct.toFixed(2)}%`);
    console.log(`Branches: ${total.branches.pct.toFixed(2)}%`);
    console.log(`Statements: ${total.statements.pct.toFixed(2)}%`);
    
    // Vérifier si la couverture est suffisante
    const threshold = 70; // Seuil de couverture (en pourcentage)
    if (
      total.lines.pct < threshold ||
      total.functions.pct < threshold ||
      total.branches.pct < threshold ||
      total.statements.pct < threshold
    ) {
      console.warn('\nAttention: La couverture de test est inférieure au seuil de ' + threshold + '%');
      console.warn('Veuillez ajouter plus de tests pour améliorer la couverture.');
    } else {
      console.log('\nLa couverture de test est supérieure au seuil de ' + threshold + '%');
    }
  }
} else {
  console.error('Le rapport de couverture n\'a pas été généré.');
  process.exit(1);
}
