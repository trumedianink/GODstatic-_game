module.exports = {
  ci: {
    collect: {
      url: [process.env.PAGES_DEV_URL || 'http://127.0.0.1:8788/'],
      numberOfRuns: 3,
      // Lighthouse's default form factor is mobile. Keep Chrome headless for pre-push use.
      settings: {
        chromeFlags: '--headless --no-sandbox',
      },
    },
    assert: {
      assertions: {
        // Begin as warnings so the first few runs establish a real local baseline.
        // Promote selected levels from "warn" to "error" once the scores are stable.
        'categories:performance': ['warn', { minScore: 0.85, aggregationMethod: 'median' }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 3000, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
