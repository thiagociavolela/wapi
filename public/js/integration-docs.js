window.addEventListener('DOMContentLoaded', () => {
  if (!window.SwaggerUIBundle) { document.querySelector('#docs-error').hidden = false; return; }
  window.ui = SwaggerUIBundle({
    url: '/openapi/integrations.json', dom_id: '#swagger-ui',
    deepLinking: true, displayRequestDuration: true, filter: true,
    docExpansion: 'list', defaultModelsExpandDepth: 1,
    persistAuthorization: false, validatorUrl: null,
    tryItOutEnabled: false,
    supportedSubmitMethods: ['get', 'post', 'delete'],
    presets: [SwaggerUIBundle.presets.apis],
    onFailure: () => { document.querySelector('#docs-error').hidden = false; }
  });
});
