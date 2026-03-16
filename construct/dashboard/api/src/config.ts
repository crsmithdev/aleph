export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || './data/goals.db',
  sessionSecret: process.env.SESSION_SECRET || 'a-very-secret-key-that-should-be-changed-in-production!!',
  rpId: process.env.RP_ID || 'localhost',
  rpName: process.env.RP_NAME || 'Goal Tracker',
  rpOrigin: process.env.RP_ORIGIN || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
};
