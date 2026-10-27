import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
appId: 'com.nyagocargo.admin',
appName: 'Nyago Cargo Admin',
webDir: 'dist',
server: {
androidScheme: 'https'
}
};

export default config;
