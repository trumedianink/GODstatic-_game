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
        // Blocking budgets use the median of three mobile-profile Lighthouse runs.
        'categories:performance': ['error', { minScore: 0.85, aggregationMethod: 'median' }],
        'largest-contentful-paint': ['error', { maxNumericValue: 3000, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
