const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !publishableKey) {
  throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

const publicClient = createClient(supabaseUrl, publishableKey, clientOptions);
const adminClient = secretKey
  ? createClient(supabaseUrl, secretKey, clientOptions)
  : null;

function createUserClient(token) {
  return createClient(supabaseUrl, publishableKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function requireAdminClient() {
  if (!adminClient) {
    const error = new Error('Server secret key is not configured');
    error.code = 'SERVER_CONFIGURATION_ERROR';
    throw error;
  }
  return adminClient;
}

module.exports = {
  publicClient,
  adminClient,
  createUserClient,
  requireAdminClient,
};

