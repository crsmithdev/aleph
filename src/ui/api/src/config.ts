const isDev = (process.env.NODE_ENV || 'development') === 'development';

export const config = {
  port: parseInt(process.env.PORT || (isDev ? '3001' : '3000'), 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV || 'development',
};
