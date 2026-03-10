const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://xzvtjcqwmuezxyeerkki.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dnRqY3F3bXVlenh5ZWVya2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMjA0MTEsImV4cCI6MjA4ODU2MDY0M30.My0BKDF4tC9egh1nZbs9G0U7KKvwJixIuo71wuPPFDo';

// Create a single supabase client for interacting with your database
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
