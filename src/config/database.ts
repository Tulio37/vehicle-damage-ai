import mongoose from 'mongoose';

let memoryServer: import('mongodb-memory-server').MongoMemoryServer | null = null;

async function getMongoUri(): Promise<string> {
  const envUri = process.env.MONGODB_URI;

  // If a real URI is set (and it's not the placeholder), use it
  if (envUri && !envUri.includes('localhost') && !envUri.includes('127.0.0.1')) {
    return envUri;
  }

  // Try connecting to local MongoDB first
  if (envUri && (envUri.includes('localhost') || envUri.includes('127.0.0.1'))) {
    try {
      const tempConn = await mongoose.createConnection(envUri).asPromise();
      await tempConn.close();
      return envUri;
    } catch {
      console.log('[DB] MongoDB local não encontrado. Usando servidor em memória (desenvolvimento).');
    }
  }

  // Fallback: in-memory MongoDB for development/testing
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  console.log('[DB] MongoDB Memory Server iniciado (dados em memória — não persistem entre reinicializações).');
  return uri;
}

export async function connectDatabase(): Promise<void> {
  const uri = await getMongoUri();

  mongoose.connection.on('connected', () => {
    console.log('[DB] MongoDB conectado.');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[DB] Erro de conexão MongoDB:', err);
  });

  await mongoose.connect(uri);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
