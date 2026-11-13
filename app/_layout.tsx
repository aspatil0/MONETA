import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { migrateDbIfNeeded } from '../src/database';

export default function RootLayout() {
  return (
    <SQLiteProvider
      databaseName="moneta.db"
      onInit={migrateDbIfNeeded}
      onError={(error) => console.error('MONETA database startup failed', error)}
      useSuspense={false}
    >
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#F4F7F5' },
          }}
        />
      </SafeAreaProvider>
    </SQLiteProvider>
  );
}
