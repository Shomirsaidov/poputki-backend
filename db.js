const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase configuration (Hardcoded to bypass incorrect environment variables on host)
const supabaseUrl = 'https://xzvtjcqwmuezxyeerkki.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dnRqY3F3bXVlenh5ZWVya2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMjA0MTEsImV4cCI6MjA4ODY5NjQxMX0.My0BKDF4tC9egh1nZbs9G0U7KKvwJixIuo71wuPPFDo';

// Create a single supabase client for interacting with your database
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
