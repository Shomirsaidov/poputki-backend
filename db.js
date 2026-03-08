const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://kszjwfnjrfouawkqjbwc.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtzemp3Zm5qcmZvdWF3a3FqYndjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODQ2NDMsImV4cCI6MjA4ODU2MDY0M30.zyK0VyKbl10rgOc36Tsugj4zWJnRN1N-LOEG2ZiXToY';

// Create a single supabase client for interacting with your database
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
