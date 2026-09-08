/**
 * CRA Webpack config overrides (used by react-app-rewired)
 */
const webpack = require('webpack');
const { version } = require('./package.json');

module.exports = function override(config) {
  // La version de l'application, injectée dans le bundle (lue en priorité par
  // src/services/platform/appVersion.ts). Sans elle, le desktop se rabattait
  // sur l'IPC (même valeur) mais le client web n'avait RIEN : il s'annonçait
  // « dev-web » en production (constaté le 2026-08-28 dans le ping de version).
  // Une seule source : package.json — jamais une copie à tenir à jour.
  config.plugins.push(
    new webpack.DefinePlugin({
      __FILARR_VERSION__: JSON.stringify(version),
    })
  );
  return config;
};
