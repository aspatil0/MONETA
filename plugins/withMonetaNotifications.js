const { withAndroidManifest, createRunOncePlugin } = require('@expo/config-plugins');

function withMonetaNotifications(config) {
  return withAndroidManifest(config, (configuration) => {
    const application = configuration.modResults.manifest.application?.[0];
    if (!application) throw new Error('MONETA notification listener requires an Android application entry.');
    application.service = application.service || [];
    const hasService = application.service.some((service) => service.$?.['android:name'] === 'com.moneta.notifications.MonetaNotificationListenerService');
    if (!hasService) {
      application.service.push({
        $: {
          'android:name': 'com.moneta.notifications.MonetaNotificationListenerService',
          'android:exported': 'true',
          'android:label': 'MONETA notification listener',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }],
      });
    }
    return configuration;
  });
}

module.exports = createRunOncePlugin(withMonetaNotifications, 'with-moneta-notifications', '1.0.0');
